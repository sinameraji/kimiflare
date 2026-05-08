const ANSI_REGEX = /\u001b\[[0-9;]*[a-zA-Z]|\u001b\][0-9;]*(?:\u0007|\u001b\\)|\u001b[()[\]{}<>=*+?!"#'%&@:;^`|~]/g;

const CONTROL_REGEX = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g;

/**
 * Strip ANSI escape sequences (CSI, OSC, and other terminal codes).
 */
export function stripAnsi(text: string): string {
	return text.replace(ANSI_REGEX, "");
}

/**
 * Remove non-printable control characters while preserving newlines and tabs.
 */
export function sanitizeBinaryOutput(text: string): string {
	return text.replace(CONTROL_REGEX, "");
}

/**
 * Full sanitize: strip ANSI + remove control chars.
 */
export function sanitizeOutput(text: string): string {
	return sanitizeBinaryOutput(stripAnsi(text));
}
