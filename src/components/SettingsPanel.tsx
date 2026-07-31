import {
  hardwareProfiles,
  runtimeProfiles,
  type HardwareProfileId,
} from "../app/config";
import type { Theme } from "../app/types";

type SettingsPanelProps = {
  activeModelName: string;
  availableModelNames: string[];
  endpointDraft: string;
  hardwareProfile: HardwareProfileId;
  isGenerating: boolean;
  setupStatusLabel: string;
  theme: Theme;
  onApplyEndpoint: () => void;
  onClose: () => void;
  onEndpointChange: (endpoint: string) => void;
  onHardwareProfileChange: (profile: HardwareProfileId) => void;
  onModelChange: (modelName: string) => void;
  onRefreshModels: () => void;
  onThemeChange: (theme: Theme) => void;
};

export function SettingsPanel({
  activeModelName,
  availableModelNames,
  endpointDraft,
  hardwareProfile,
  isGenerating,
  setupStatusLabel,
  theme,
  onApplyEndpoint,
  onClose,
  onEndpointChange,
  onHardwareProfileChange,
  onModelChange,
  onRefreshModels,
  onThemeChange,
}: SettingsPanelProps) {
  const selectedHardwareProfile =
    hardwareProfiles.find((profile) => profile.id === hardwareProfile) ??
    hardwareProfiles[1];
  const runtimeProfile = runtimeProfiles[hardwareProfile];

  return (
    <section className="card settings-card">
      <div className="settings-header">
        <div>
          <h3>Settings</h3>
          <p>
            Configure the local model connection and choose the device profile
            for this app.
          </p>
        </div>
        <button
          type="button"
          className="settings-close-button"
          onClick={onClose}
        >
          Back to chat
        </button>
      </div>

      <div className="settings-grid">
        <section className="settings-panel">
          <div className="settings-panel-header">
            <h4>Local AI</h4>
            <p>{setupStatusLabel}</p>
          </div>
          <label className="settings-field">
            <span>Ollama endpoint</span>
            <div className="settings-input-row">
              <input
                className="settings-input"
                type="text"
                value={endpointDraft}
                onChange={(event) => onEndpointChange(event.currentTarget.value)}
                placeholder="http://127.0.0.1:11434"
              />
              <button
                type="button"
                className="settings-apply-button"
                onClick={onApplyEndpoint}
              >
                Apply
              </button>
            </div>
          </label>
          <label className="settings-field">
            <span>Model</span>
            <select
              className="settings-select"
              value={activeModelName}
              disabled={!availableModelNames.length || isGenerating}
              onChange={(event) => onModelChange(event.currentTarget.value)}
            >
              {availableModelNames.length ? (
                availableModelNames.map((modelName) => (
                  <option key={modelName} value={modelName}>
                    {modelName}
                  </option>
                ))
              ) : (
                <option value="">No models found</option>
              )}
            </select>
          </label>
          <div className="settings-actions">
            <button
              type="button"
              className="settings-secondary-button"
              onClick={onRefreshModels}
            >
              Retry connection
            </button>
            <p className="settings-note">
              Local processing stays on this device unless you add online
              features later.
            </p>
          </div>
        </section>

        <section className="settings-panel">
          <div className="settings-panel-header">
            <h4>Device profile</h4>
            <p>
              Each profile changes how much file content and chat history are
              sent to the local model.
            </p>
          </div>
          <div
            className="settings-profile-list"
            role="radiogroup"
            aria-label="Hardware profile"
          >
            {hardwareProfiles.map((profile) => (
              <button
                key={profile.id}
                type="button"
                className={`settings-profile-card${
                  profile.id === hardwareProfile ? " active" : ""
                }`}
                aria-pressed={profile.id === hardwareProfile}
                onClick={() => onHardwareProfileChange(profile.id)}
              >
                <strong>{profile.label}</strong>
                <span>{profile.description}</span>
              </button>
            ))}
          </div>
          <label className="settings-field">
            <span>Theme</span>
            <select
              className="settings-select"
              value={theme}
              onChange={(event) =>
                onThemeChange(event.currentTarget.value as Theme)
              }
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>
          <div className="settings-summary">
            <strong>{selectedHardwareProfile.label}</strong>
            <span>{selectedHardwareProfile.description}</span>
            <small>
              Sends up to {runtimeProfile.previewCharacters.toLocaleString()} file
              characters and {runtimeProfile.recentMessageCount} recent messages.
            </small>
          </div>
        </section>
      </div>
    </section>
  );
}
