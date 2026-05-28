/**
 * Windows Firewall self-installer.
 *
 * Background: a per-user NSIS install (`oneClick: true, perMachine: false`)
 * has no admin token, so we can't add firewall rules at install time. The
 * symptom is the classic "Mac can't see Windows on mDNS even though Windows
 * sees Mac" — Defender Firewall happily replies to inbound queries to ports
 * it knows about, but drops unsolicited inbound multicast (UDP/5353) and
 * blocks WebSocket peers reaching :4711.
 *
 * Fix: on first launch, prompt the user to add an "allow Presentatool.exe
 * inbound on Private+Domain profiles" rule. The rule is keyed off the exe
 * path so it covers all ports the app uses — WebSocket, mDNS multicast,
 * future relay endpoints — without us having to enumerate them.
 *
 * The prompt is one-time (we remember declined-vs-not in settings) and the
 * elevation happens through PowerShell's `Start-Process -Verb RunAs`, which
 * triggers a standard UAC dialog. If the user declines either the in-app
 * dialog or the UAC dialog, we record the decision and don't ask again
 * until they change `network.firewallPromptStatus` in Settings.
 */

import { app, dialog } from 'electron';
import { spawn } from 'child_process';
import { getSettings, updateSettings } from './settings';

const RULE_NAME = 'Presentatool';

export async function ensureWindowsFirewallException(): Promise<void> {
  if (process.platform !== 'win32') return;
  if (!app.isPackaged) return; // don't fiddle with the dev tsc output

  const settings = getSettings();
  const status = settings.network.firewallPromptStatus;
  // 'added' means we already installed the rule; 'declined' means the user
  // said no — in both cases we leave them alone. Anything else (undefined,
  // 'pending', 'failed') is a chance to ask again.
  if (status === 'added' || status === 'declined') return;

  const exePath = app.getPath('exe');
  // Quick check: does a rule already exist (e.g. from a prior install)? If so,
  // record that and move on without asking the user.
  try {
    if (await ruleExists(RULE_NAME)) {
      updateSettings({ network: { ...settings.network, firewallPromptStatus: 'added' } });
      return;
    }
  } catch (err) {
    console.warn('[firewall] rule-exists check failed', err);
  }

  const choice = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Allow through firewall', 'Not now'],
    defaultId: 0,
    cancelId: 1,
    title: 'Presentatool — network access',
    message: 'Let other devices on your LAN reach Presentatool?',
    detail:
      'Windows Firewall is currently blocking inbound connections to Presentatool. ' +
      'Without this, other Presentatool peers and the Bitfocus Companion module ' +
      'on your network won\'t discover this machine.\n\n' +
      'Clicking "Allow" will request a one-time admin prompt to add a rule that ' +
      'permits Presentatool.exe inbound on Private and Domain networks.',
  });

  if (choice.response !== 0) {
    updateSettings({ network: { ...settings.network, firewallPromptStatus: 'declined' } });
    return;
  }

  try {
    await runElevated(exePath);
    updateSettings({ network: { ...settings.network, firewallPromptStatus: 'added' } });
    await dialog.showMessageBox({
      type: 'info',
      buttons: ['OK'],
      title: 'Presentatool',
      message: 'Firewall rule added.',
      detail: 'Other devices on your LAN should discover Presentatool within ~10 seconds.',
    });
  } catch (err) {
    console.warn('[firewall] failed to add rule', err);
    updateSettings({ network: { ...settings.network, firewallPromptStatus: 'failed' } });
    await dialog.showMessageBox({
      type: 'warning',
      buttons: ['OK'],
      title: 'Presentatool',
      message: 'Could not add firewall rule.',
      detail:
        'You can add it manually from an elevated PowerShell:\n\n' +
        `netsh advfirewall firewall add rule name="${RULE_NAME}" dir=in action=allow program="${exePath}" enable=yes profile=private,domain\n\n` +
        'Or use Static Peers in Settings → Network as a workaround.',
    });
  }
}

/** Returns true if a rule with the given name already exists. */
function ruleExists(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('netsh', ['advfirewall', 'firewall', 'show', 'rule', `name=${name}`], {
      windowsHide: true,
    });
    let stdout = '';
    child.stdout?.on('data', (b: Buffer) => { stdout += b.toString(); });
    child.on('error', () => resolve(false));
    child.on('close', (code) => {
      // netsh returns 1 when no rule by that name exists; 0 when it found one.
      resolve(code === 0 && /Rule Name:/i.test(stdout));
    });
  });
}

/**
 * Add the rule using elevated PowerShell. We shell to `powershell.exe` with
 * `Start-Process -Verb RunAs` so Windows shows the UAC consent dialog. The
 * inner command deletes any pre-existing rule of the same name (lets us
 * overwrite cleanly if the exe path changed across reinstalls) and then
 * adds a fresh allow-program rule.
 */
function runElevated(exePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // The inner netsh commands run as a single PowerShell job invoked
    // elevated. We pass through a base64-encoded script to avoid having to
    // escape quotes and ampersands through three layers of cmd / PowerShell.
    const inner = [
      `netsh advfirewall firewall delete rule name='${RULE_NAME}' | Out-Null`,
      `netsh advfirewall firewall add rule name='${RULE_NAME}' dir=in action=allow program='${exePath}' enable=yes profile=private,domain | Out-Null`,
      // Future: also add an explicit UDP 5353 rule that covers the case
      // where the user moves Presentatool.exe — for now the program-rule
      // is enough since Windows binds it to the exe inode, not the path.
      `exit 0`,
    ].join('; ');
    const innerBase64 = Buffer.from(inner, 'utf16le').toString('base64');

    // Outer launcher: a non-elevated PowerShell that asks Windows to run the
    // inner script elevated, then waits for it to finish. -Wait is essential
    // so we can read the exit code.
    const launcher = [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-Command',
      `Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${innerBase64}' -Verb RunAs -Wait`,
    ];

    const child = spawn('powershell.exe', launcher, { windowsHide: true });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`elevated PowerShell exited with code ${code}`));
    });
  });
}
