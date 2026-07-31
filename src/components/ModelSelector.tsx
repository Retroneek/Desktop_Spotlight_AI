import { getModelDisplayName } from "../services/models";

type ModelSelectorProps = {
  activeModelName: string;
  availableModelNames: string[];
  isGenerating: boolean;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onSelect: (modelName: string) => void;
};

export function ModelSelector({
  activeModelName,
  availableModelNames,
  isGenerating,
  isOpen,
  onOpenChange,
  onSelect,
}: ModelSelectorProps) {
  return (
    <div className="model-select-shell">
      <span className="model-local-status" aria-label="Local model">
        <i aria-hidden="true" />
      </span>
      <button
        type="button"
        className="model-select-trigger"
        aria-label="Select model"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        title={activeModelName || "No models found"}
        disabled={!availableModelNames.length || isGenerating}
        onClick={() => onOpenChange(!isOpen)}
      >
        <span className="model-select-value">
          {activeModelName
            ? getModelDisplayName(activeModelName)
            : "No models found"}
        </span>
      </button>

      {isOpen && availableModelNames.length ? (
        <div
          className="model-select-menu"
          role="listbox"
          aria-label="Available models"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {availableModelNames.map((modelName) => (
            <button
              key={modelName}
              type="button"
              role="option"
              aria-selected={modelName === activeModelName}
              className={`model-select-option${
                modelName === activeModelName ? " active" : ""
              }`}
              onClick={() => onSelect(modelName)}
            >
              <span>{getModelDisplayName(modelName)}</span>
              <small>{modelName}</small>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
