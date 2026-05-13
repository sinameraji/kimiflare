import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { CustomTextInput } from "./text-input.js";
import { useTheme } from "./theme-context.js";

interface Props {
  onDone: () => void;
  onOpen: (url: string) => void;
}

type Step = "twitter" | "secret" | "checking" | "result";

const FEEDBACK_WORKER_URL = "https://hello.kimiflare.com";

export function InboxModal({ onDone, onOpen }: Props) {
  const theme = useTheme();
  const [step, setStep] = useState<Step>("twitter");
  const [twitter, setTwitter] = useState("");
  const [secret, setSecret] = useState("");
  const [hasMessage, setHasMessage] = useState(false);
  const [createdAt, setCreatedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checkInbox = useCallback(
    async (u: string, s: string) => {
      setStep("checking");
      setError(null);
      try {
        const res = await fetch(
          `${FEEDBACK_WORKER_URL}/inbox/check?u=${encodeURIComponent(u)}&s=${encodeURIComponent(s)}`
        );
        if (!res.ok) {
          throw new Error(`Server returned ${res.status}`);
        }
        const data = (await res.json()) as { hasMessage: boolean; createdAt?: number };
        setHasMessage(data.hasMessage);
        setCreatedAt(data.createdAt ?? null);
        setStep("result");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStep("result");
      }
    },
    []
  );

  const handleTwitterSubmit = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) {
        onDone();
        return;
      }
      setTwitter(trimmed);
      setStep("secret");
    },
    [onDone]
  );

  const handleSecretSubmit = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) {
        onDone();
        return;
      }
      setSecret(trimmed);
      void checkInbox(twitter, trimmed);
    },
    [twitter, checkInbox, onDone]
  );

  useInput(
    (_input, key) => {
      if (key.escape) {
        onDone();
        return;
      }
      if (step === "result" && hasMessage && key.return) {
        const url = `${FEEDBACK_WORKER_URL}/inbox?u=${encodeURIComponent(twitter)}&s=${encodeURIComponent(secret)}`;
        onOpen(url);
        onDone();
      }
    },
    { isActive: step === "result" }
  );

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text color={theme.accent} bold>
        /inbox
      </Text>

      {step === "twitter" && (
        <>
          <Text color={theme.palette.foreground}>Enter your Twitter username (or press Enter to cancel):</Text>
          <Box marginTop={1}>
            <CustomTextInput
              value={twitter}
              onChange={setTwitter}
              onSubmit={handleTwitterSubmit}
              focus
            />
          </Box>
        </>
      )}

      {step === "secret" && (
        <>
          <Text color={theme.palette.foreground}>Enter your secret (or press Enter to cancel):</Text>
          <Box marginTop={1}>
            <CustomTextInput
              value={secret}
              onChange={setSecret}
              onSubmit={handleSecretSubmit}
              mask="*"
              focus
            />
          </Box>
        </>
      )}

      {step === "checking" && (
        <Text color={theme.info.color}>Checking your inbox…</Text>
      )}

      {step === "result" && (
        <>
          {error ? (
            <Text color={theme.error}>Error: {error}</Text>
          ) : hasMessage ? (
            <>
              <Text color={theme.palette.foreground}>
                You have a voice message from Sina
                {createdAt ? ` (${new Date(createdAt).toLocaleString()})` : ""}.
              </Text>
              <Text color={theme.info.color}>Press Enter to open it in your browser.</Text>
            </>
          ) : (
            <Text color={theme.muted?.color ?? theme.palette.secondary}>
              No messages yet for @{twitter} / {secret.replace(/./g, "*")}.
            </Text>
          )}
          <Text dimColor>Press Esc to close.</Text>
        </>
      )}
    </Box>
  );
}
