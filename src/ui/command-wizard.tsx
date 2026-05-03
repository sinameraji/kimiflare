import React, { useState } from "react";
import { Box, Text, useInput, useWindowSize } from "ink";
import SelectInput from "ink-select-input";
import { CustomTextInput } from "./text-input.js";
import { useTheme } from "./theme-context.js";
import type { Theme } from "./theme.js";
import type { Mode } from "../mode.js";
import type { ReasoningEffort } from "../config.js";
import type { CommandSource, CustomCommand } from "../commands/types.js";
import type { SaveCustomCommandOptions } from "../commands/save.js";

interface Props {
  mode: "create" | "edit";
  initial?: CustomCommand;
  existingNames: string[];
  builtinNames: Set<string>;
  onDone: () => void;
  onSave: (opts: SaveCustomCommandOptions) => void;
}

type Step =
  | "name"
  | "description"
  | "template"
  | "advanced"
  | "mode"
  | "effort"
  | "model"
  | "location"
  | "confirm";

const NAME_RE = /^[a-zA-Z][a-zA-Z0-9_\-/]*$/;

export function CommandWizard({ mode, initial, existingNames, builtinNames, onDone, onSave }: Props) {
  const theme = useTheme();
  const [step, setStep] = useState<Step>("name");
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [template, setTemplate] = useState(initial?.template ?? "");
  const [cmdMode, setCmdMode] = useState<Mode | undefined>(initial?.mode);
  const [cmdEffort, setCmdEffort] = useState<ReasoningEffort | undefined>(initial?.effort);
  const [cmdModel, setCmdModel] = useState<string | undefined>(initial?.model);
  const [source, setSource] = useState<CommandSource>(initial?.source ?? "project");
  const [error, setError] = useState<string | null>(null);
  const { columns } = useWindowSize();

  const totalSteps = 5; // approximate for progress indicator
  const stepIndex =
    step === "name" ? 1 :
    step === "description" ? 2 :
    step === "template" ? 3 :
    step === "advanced" || step === "mode" || step === "effort" || step === "model" ? 4 :
    step === "location" ? 4 :
    5;

  const isEditingSelf = (n: string) => initial !== undefined && initial.name === n;

  const validateName = (n: string): string | null => {
    const trimmed = n.trim();
    if (!trimmed) return "name is required";
    if (!NAME_RE.test(trimmed)) return "invalid name: use letters, numbers, _ - / only; must start with a letter";
    if (builtinNames.has(trimmed.toLowerCase())) return `/${trimmed} is a built-in command`;
    if (existingNames.includes(trimmed) && !isEditingSelf(trimmed)) return `/${trimmed} already exists`;
    return null;
  };

  useInput((_input, key) => {
    if (key.escape) {
      onDone();
    }
  });

  const handleNameSubmit = (value: string) => {
    const trimmed = value.trim();
    const err = validateName(trimmed);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setName(trimmed);
    setStep("description");
  };

  const handleDescriptionSubmit = (value: string) => {
    setDescription(value.trim());
    setStep("template");
  };

  const handleTemplateSubmit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setError("template cannot be empty");
      return;
    }
    setError(null);
    setTemplate(trimmed);
    setStep("advanced");
  };

  const handleAdvancedChoice = (choice: "set" | "skip") => {
    if (choice === "skip") {
      setCmdMode(undefined);
      setCmdEffort(undefined);
      setCmdModel("");
      if (mode === "edit" && initial) {
        setSource(initial.source);
        setStep("confirm");
      } else {
        setStep("location");
      }
    } else {
      setStep("mode");
    }
  };

  const handleModeChoice = (m: Mode | "none") => {
    setCmdMode(m === "none" ? undefined : m);
    setStep("effort");
  };

  const handleEffortChoice = (e: ReasoningEffort | "none") => {
    setCmdEffort(e === "none" ? undefined : e);
    setStep("model");
  };

  const handleModelSubmit = (value: string) => {
    const trimmed = value.trim();
    setCmdModel(trimmed || undefined);
    if (mode === "edit" && initial) {
      setSource(initial.source);
      setStep("confirm");
    } else {
      setStep("location");
    }
  };

  const handleLocationChoice = (s: CommandSource) => {
    setSource(s);
    setStep("confirm");
  };

  const handleConfirm = (choice: "save" | "cancel") => {
    if (choice === "cancel") {
      onDone();
      return;
    }
    onSave({
      name,
      description: description || undefined,
      template,
      source,
      mode: cmdMode,
      model: cmdModel || undefined,
      effort: cmdEffort,
    });
  };

  const previewContent = () => {
    const data: Record<string, string | undefined> = {};
    if (description) data.description = description;
    if (cmdMode) data.mode = cmdMode;
    if (cmdModel) data.model = cmdModel;
    if (cmdEffort) data.effort = cmdEffort;

    const fm = Object.entries(data)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");

    if (fm) {
      return `---\n${fm}\n---\n${template}`;
    }
    return template;
  };

  const renderStep = () => {
    switch (step) {
      case "name":
        return (
          <>
            <Text color={theme.accent} bold>
              {mode === "create" ? "Create" : "Edit"} custom command — Name ({stepIndex}/{totalSteps})
            </Text>
            {error && <Text color={theme.error}>{error}</Text>}
            <Box marginTop={1}>
              <CustomTextInput
                value={name}
                onChange={setName}
                onSubmit={handleNameSubmit}
                focus
              />
            </Box>
            <Text color={theme.info.color}>
              letters, numbers, _ - / only; must start with a letter
            </Text>
          </>
        );

      case "description":
        return (
          <>
            <Text color={theme.accent} bold>
              {mode === "create" ? "Create" : "Edit"} custom command — Description ({stepIndex}/{totalSteps})
            </Text>
            <Box marginTop={1}>
              <CustomTextInput
                value={description}
                onChange={setDescription}
                onSubmit={handleDescriptionSubmit}
                focus
              />
            </Box>
            <Text color={theme.info.color}>
              Press Enter to skip
            </Text>
          </>
        );

      case "template": {
        const guide = (
          <Box flexDirection="column" paddingLeft={1}>
            <Text color={theme.accent} bold>
              What is this?
            </Text>
            <Text color={theme.info.color}>
              A prompt template — instructions to the AI.
            </Text>
            <Text color={theme.info.color}>
              When you type /{name || "yourcommand"} later, this gets sent to the model.
            </Text>
            <Box marginTop={1} flexDirection="column">
              <Text color={theme.accent} bold>
                Variables
              </Text>
              <Text color={theme.info.color}>
                {"  "}$1, $2 ...     → arguments you type
              </Text>
              <Text color={theme.info.color}>
                {"  "}$ARGUMENTS     → everything after the command
              </Text>
            </Box>
            <Box marginTop={1} flexDirection="column">
              <Text color={theme.accent} bold>
                Dynamic inlines
              </Text>
              <Text color={theme.info.color}>
                {"  "}!`git diff`    → shell output inlined
              </Text>
              <Text color={theme.info.color}>
                {"  "}@README.md     → file contents inlined
              </Text>
            </Box>
            <Box marginTop={1} flexDirection="column">
              <Text color={theme.accent} bold>
                Example
              </Text>
              <Text color={theme.info.color}>
                Review this PR diff:
              </Text>
              <Text color={theme.info.color}>
                !`git diff main...HEAD`
              </Text>
              <Text color={theme.info.color}>
                Focus on: $1
              </Text>
            </Box>
          </Box>
        );

        const inputArea = (
          <Box flexDirection="column" flexGrow={1}>
            {error && <Text color={theme.error}>{error}</Text>}
            <Box marginTop={1}>
              <CustomTextInput
                value={template}
                onChange={setTemplate}
                onSubmit={handleTemplateSubmit}
                focus
                enablePaste
              />
            </Box>
            {columns < 100 && (
              <>
                <Text color={theme.info.color}>
                  Paste multi-line templates with Ctrl+V.
                </Text>
                <Text color={theme.info.color}>
                  Variables: $1 $2 ... $ARGUMENTS  Shell: !`cmd`  File: @path
                </Text>
              </>
            )}
          </Box>
        );

        return (
          <>
            <Text color={theme.accent} bold>
              {mode === "create" ? "Create" : "Edit"} custom command — Template ({stepIndex}/{totalSteps})
            </Text>
            {columns >= 100 ? (
              <Box flexDirection="row" marginTop={1}>
                <Box flexDirection="column" width="50%">
                  {inputArea}
                </Box>
                <Box flexDirection="column" width="50%">
                  {guide}
                </Box>
              </Box>
            ) : (
              <Box flexDirection="column" marginTop={1}>
                {inputArea}
              </Box>
            )}
          </>
        );
      }

      case "advanced": {
        const items = [
          { label: "Set advanced options", value: "set", key: "set" },
          { label: "Skip", value: "skip", key: "skip" },
          { label: "← Cancel", value: "cancel", key: "cancel" },
        ];
        return (
          <>
            <Text color={theme.accent} bold>
              {mode === "create" ? "Create" : "Edit"} custom command — Options ({stepIndex}/{totalSteps})
            </Text>
            <Box marginTop={1}>
              <SelectInput
                items={items}
                onSelect={(item) => {
                  if (item.value === "cancel") onDone();
                  else handleAdvancedChoice(item.value as "set" | "skip");
                }}
              />
            </Box>
          </>
        );
      }

      case "mode": {
        const items = [
          { label: cmdMode === undefined ? "none · current" : "none", value: "none", key: "none" },
          { label: cmdMode === "edit" ? "edit · current" : "edit", value: "edit", key: "edit" },
          { label: cmdMode === "plan" ? "plan · current" : "plan", value: "plan", key: "plan" },
          { label: cmdMode === "auto" ? "auto · current" : "auto", value: "auto", key: "auto" },
          { label: "← Back", value: "__back__", key: "__back__" },
        ];
        return (
          <>
            <Text color={theme.accent} bold>
              Mode override ({stepIndex}/{totalSteps})
            </Text>
            <Text color={theme.info.color}>
              Saved to file but not yet enforced at runtime
            </Text>
            <Box marginTop={1}>
              <SelectInput
                items={items}
                onSelect={(item) => {
                  if (item.value === "__back__") setStep("advanced");
                  else handleModeChoice(item.value as Mode | "none");
                }}
              />
            </Box>
          </>
        );
      }

      case "effort": {
        const items = [
          { label: cmdEffort === undefined ? "none · current" : "none", value: "none", key: "none" },
          { label: cmdEffort === "low" ? "low · current" : "low", value: "low", key: "low" },
          { label: cmdEffort === "medium" ? "medium · current" : "medium", value: "medium", key: "medium" },
          { label: cmdEffort === "high" ? "high · current" : "high", value: "high", key: "high" },
          { label: "← Back", value: "__back__", key: "__back__" },
        ];
        return (
          <>
            <Text color={theme.accent} bold>
              Reasoning effort ({stepIndex}/{totalSteps})
            </Text>
            <Box marginTop={1}>
              <SelectInput
                items={items}
                onSelect={(item) => {
                  if (item.value === "__back__") setStep("mode");
                  else handleEffortChoice(item.value as ReasoningEffort | "none");
                }}
              />
            </Box>
          </>
        );
      }

      case "model":
        return (
          <>
            <Text color={theme.accent} bold>
              Model override ({stepIndex}/{totalSteps})
            </Text>
            <Box marginTop={1}>
              <CustomTextInput
                value={cmdModel ?? ""}
                onChange={setCmdModel}
                onSubmit={handleModelSubmit}
                focus
              />
            </Box>
            <Text color={theme.info.color}>
              Press Enter to skip
            </Text>
          </>
        );

      case "location": {
        const items = [
          { label: source === "project" ? "Project · current" : "Project", value: "project", key: "project" },
          { label: source === "global" ? "Global · current" : "Global", value: "global", key: "global" },
          { label: "← Back", value: "__back__", key: "__back__" },
        ];
        return (
          <>
            <Text color={theme.accent} bold>
              Save location ({stepIndex}/{totalSteps})
            </Text>
            <Box marginTop={1}>
              <SelectInput
                items={items}
                onSelect={(item) => {
                  if (item.value === "__back__") setStep("advanced");
                  else handleLocationChoice(item.value as CommandSource);
                }}
              />
            </Box>
            <Text color={theme.info.color}>
              Project: .kimiflare/commands/    Global: ~/.config/kimiflare/commands/
            </Text>
          </>
        );
      }

      case "confirm": {
        const items = [
          { label: "Save", value: "save", key: "save" },
          { label: "Cancel", value: "cancel", key: "cancel" },
        ];
        return (
          <>
            <Text color={theme.accent} bold>
              {mode === "create" ? "Create" : "Edit"} custom command — Confirm ({stepIndex}/{totalSteps})
            </Text>
            <Text color={theme.info.color}>
              {source === "project" ? ".kimiflare/commands/" : "~/.config/kimiflare/commands/"}
              {name}.md
            </Text>
            <Box marginTop={1} flexDirection="column">
              {previewContent().split("\n").map((line, i) => (
                <Text key={i} color={theme.info.color}>
                  {line || " "}
                </Text>
              ))}
            </Box>
            <Box marginTop={1}>
              <SelectInput
                items={items}
                onSelect={(item) => handleConfirm(item.value as "save" | "cancel")}
              />
            </Box>
          </>
        );
      }
    }
  };

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
      {renderStep()}
    </Box>
  );
}
