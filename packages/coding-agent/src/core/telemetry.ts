import type { SettingsManager } from "./settings-manager.ts";

// Fork: install telemetry is disabled. The signature is kept so upstream
// merges apply cleanly; pi never reports installs or sends attribution.
export function isInstallTelemetryEnabled(
	_settingsManager: SettingsManager,
	_telemetryEnv: string | undefined = process.env.PI_TELEMETRY,
): boolean {
	return false;
}
