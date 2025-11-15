import * as vscode from "vscode";
import type { XcodeScheme } from "../common/cli/scripts";
import type { ExtensionContext } from "../common/commands";
import { commonLogger } from "../common/logger";
import type { BuildManager } from "./manager";

type EventData = BuildTreeItem | undefined | null | undefined;

export class BuildTreeItem extends vscode.TreeItem {
  public provider: BuildTreeProvider;
  public scheme: string;

  constructor(options: {
    scheme: string;
    isDefaultBuild: boolean;
    isDefaultTesting: boolean;
    isSchemeRunning: boolean;
    collapsibleState: vscode.TreeItemCollapsibleState;
    provider: BuildTreeProvider;
  }) {
    super(options.scheme, options.collapsibleState);
    this.provider = options.provider;
    this.scheme = options.scheme;
    const color = new vscode.ThemeColor("sweetpad.scheme");
    this.iconPath = new vscode.ThemeIcon("sweetpad-package", color);

    let description = "";
    if (options.isDefaultBuild) {
      description = `${description} ✓`;
    }
    if (options.isDefaultTesting) {
      description = `${description} (t)`;
    }
    if (description) {
      this.description = description;
    }

    // Examples:
    //  - build&status=running
    //  - build&status=stopped
    const status = options.isSchemeRunning ? "running" : "idle";
    const contextPrefix = "build";
    this.contextValue = `${contextPrefix}&status=${status}`;
  }
}

export class BuildTreeProvider implements vscode.TreeDataProvider<BuildTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<EventData>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  public context: ExtensionContext | undefined;
  public buildManager: BuildManager;
  private isLoading = false;

  constructor(options: { context: ExtensionContext; buildManager: BuildManager }) {
    this.context = options.context;
    this.buildManager = options.buildManager;

    this.buildManager.on("refreshSchemesStarted", () => {
      this.isLoading = true;
      this.updateView();
    });
    this.buildManager.on("refreshSchemesCompleted", () => {
      this.isLoading = false;
      this.updateView();
    });
    this.buildManager.on("refreshSchemesFailed", () => {
      this.isLoading = false;
      this.updateView();
    });

    this.buildManager.on("defaultSchemeForBuildUpdated", (scheme) => {
      this.updateView();
    });
    this.buildManager.on("defaultSchemeForTestingUpdated", (scheme) => {
      this.updateView();
    });
  }

  private updateView(): void {
    // We notify VSCode to update whole tree starting from root. Not so efficient,
    // but helps to keep code simple
    this._onDidChangeTreeData.fire(null);
  }

  async getChildren(element?: BuildTreeItem | undefined): Promise<BuildTreeItem[]> {
    // we only have one level of children, so if element is defined, we return empty array
    // to prevent vscode from expanding the item further
    if (element !== undefined) {
      return [];
    }

    // If we have a refresh event in progress, we wait for it to finish.
    // NOTE: it's prone to race conditions, but let's keep it simple for now and fix it later if needed.
    if (this.isLoading) {
      const deadline = Date.now() + 10 * 1000; // 10 seconds timeout
      await new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (!this.isLoading || Date.now() > deadline) {
            clearInterval(interval);
            resolve();
          }
        }, 100); // check every 100ms
      });
    }

    // After loading is done, we already have the schemes in the build manager, so
    // this operation should be fast and not require any additional processing.
    return await this.getSchemes();
  }

  async getTreeItem(element: BuildTreeItem): Promise<BuildTreeItem> {
    return element;
  }

  async getSchemes(): Promise<BuildTreeItem[]> {
    let schemes: XcodeScheme[] = [];
    try {
      schemes = await this.buildManager.getSchemes();
    } catch (error) {
      commonLogger.error("Failed to get schemes", {
        error: error,
      });
    }

    if (schemes.length === 0) {
      // Display welcome screen with explanation what to do.
      // See "viewsWelcome": [ {"view": "sweetpad.build.view", ...} ] in package.json
      vscode.commands.executeCommand("setContext", "sweetpad.build.noSchemes", true);
    }

    const defaultSchemeForBuild = this.buildManager.getDefaultSchemeForBuild();
    const defaultSchemeForTesting = this.buildManager.getDefaultSchemeForTesting();

    // return list of schemes
    return schemes.map((scheme) => {
      const isDefaultBuild = scheme.name === defaultSchemeForBuild;
      const isDefaultTesting = scheme.name === defaultSchemeForTesting;
      const isSchemeRunning = this.buildManager.isSchemeRunning(scheme.name);

      return new BuildTreeItem({
        scheme: scheme.name,
        isDefaultBuild: isDefaultBuild,
        isDefaultTesting: isDefaultTesting,
        isSchemeRunning: isSchemeRunning,
        collapsibleState: vscode.TreeItemCollapsibleState.None,
        provider: this,
      });
    });
  }
}
