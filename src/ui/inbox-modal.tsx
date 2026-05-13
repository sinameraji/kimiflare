import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { CustomTextInput } from "./text-input.js";
import { useTheme } from "./theme-context.js";

interface Props {
  onDone: () => void;
  onOpen: (url: string) => void;
}

interface InboxMessage {
  id: string;
  createdAt: number;
  seen: boolean;
}

type Step = "twitter" | "secret" | "checking" | "result";

const FEEDBACK_WORKER_URL = "https://hello.kimiflare.com";

export function InboxModal({ onDone, onOpen }: Props) {
  const theme = useTheme();
  const [step, setStep] = useState<Step>("twitter");
  const [twitter, setTwitter] = useState("");
  const [secret, setSecret] = useState("");
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
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
        const data = (await res.json()) as {
          hasMessage: boolean;
          unreadCount: number;
          messages: InboxMessage[];
        };
        // Sort newest first
        const sorted = (data.messages ?? []).sort((a, b) => b.createdAt - a.createdAt);
        setMessages(sorted);
        setSelectedIndex(0);
        setStep("result");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setMessages([]);
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

  const openSelected = useCallback(() => {
    if (messages.length === 0) return;
    const msg = messages[selectedIndex];
    if (!msg) return;
    const url = `${FEEDBACK_WORKER_URL}/inbox?u=${encodeURIComponent(twitter)}&s=${encodeURIComponent(secret)}&m=${encodeURIComponent(msg.id)}`;
    onOpen(url);
    onDone();
  }, [messages, selectedIndex, twitter, secret, onOpen, onDone]);

  useInput(
    (_input, key) => {
      if (key.escape) {
        onDone();
        return;
      }
      if (step === "result") {
        if (key.upArrow) {
          setSelectedIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (key.downArrow) {
          setSelectedIndex((i) => Math.min(messages.length - 1, i + 1));
          return;
        }
        if (key.return && messages.length > 0) {
          openSelected();
        }
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
          ) : messages.length > 0 ? (
            <>
              <Text color={theme.palette.foreground}>
                You have {messages.length} message{messages.length === 1 ? "" : "s"}
                {messages.some((m) => !m.seen) ? " (🔴 new)" : ""}:
              </Text>
              <Box flexDirection="column" marginTop={1}>
                {messages.map((msg, idx) => {
                  const isSelected = idx === selectedIndex;
                  const dateStr = new Date(msg.createdAt).toLocaleString();
                  const marker = msg.seen ? "  " : "🔴 ";
                  return (
                    <Text
                      key={msg.id}
                      color={isSelected ? theme.accent : theme.palette.foreground}
                      bold={isSelected}
                      dimColor={!isSelected && msg.seen}
                    >
                      {isSelected ? "> " : "  "}
                      {marker}{dateStr}
                      {msg.seen ? " (played)" : " (new)"}
                    </Text>
                  );
                })}
              </Box>
              <Box marginTop={1}>
                <Text color={theme.info.color}>↑↓ to select · Enter to open in browser</Text>
              </Box>
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
