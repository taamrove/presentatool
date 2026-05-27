import { InstanceBase, runEntrypoint, InstanceStatus } from '@companion-module/base';
import type { SomeCompanionConfigField } from '@companion-module/base';
import type { ModuleConfig } from './types';
import { configFields } from './config';
import { Connection } from './connection';
import { buildActions } from './actions';
import { variableDefinitions, variableValues } from './variables';
import { buildFeedbacks } from './feedbacks';
import { buildPresets } from './presets';

export class PresentoolInstance extends InstanceBase<ModuleConfig> {
  config!: ModuleConfig;
  connection!: Connection;

  async init(config: ModuleConfig): Promise<void> {
    this.config = config;
    this.connection = new Connection(this);
    this.updateStatus(InstanceStatus.Connecting);
    this.refreshAll();
    this.connection.start();
  }

  async destroy(): Promise<void> {
    this.connection?.stop();
  }

  async configUpdated(config: ModuleConfig): Promise<void> {
    this.config = config;
    this.connection.stop();
    this.connection = new Connection(this);
    this.connection.start();
  }

  getConfigFields(): SomeCompanionConfigField[] {
    return configFields();
  }

  refreshAll(): void {
    this.refreshActions();
    this.setVariableDefinitions(variableDefinitions());
    this.setFeedbackDefinitions(buildFeedbacks(this));
    this.setPresetDefinitions(buildPresets());
    this.refreshVariables();
    this.refreshFeedbacks();
  }

  refreshActions(): void {
    this.setActionDefinitions(buildActions(this));
  }

  refreshVariables(): void {
    this.setVariableValues(variableValues(this));
    this.checkFeedbacks('on_slide');
  }

  refreshFeedbacks(): void {
    this.checkFeedbacks('connected', 'on_slide');
  }
}

runEntrypoint(PresentoolInstance, []);
