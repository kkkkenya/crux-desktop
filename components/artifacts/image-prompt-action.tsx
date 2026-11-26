"use client";

import { useEffect, useState } from "react";
import { CopyIcon, ExternalLinkIcon } from "lucide-react";

/** Where the student goes to make the picture. Gemini first; any image AI takes the same prompt. */
export const IMAGE_AI_URL = "https://gemini.google.com/app";

/** Copies text to the clipboard. Returns false when neither route works (the prompt stays visible to copy by hand). */
export async function copyText(text: string): Promise<boolean> {
	try {
		if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
			return true;
		}
	} catch {
		// fall through to the selection-based copy below
	}
	try {
		if (typeof document === "undefined") return false;
		const area = document.createElement("textarea");
		area.value = text;
		area.setAttribute("readonly", "");
		area.style.position = "fixed";
		area.style.opacity = "0";
		document.body.appendChild(area);
		area.select();
		const ok = document.execCommand("copy");
		document.body.removeChild(area);
		return ok;
	} catch {
		return false;
	}
}

/**
 * The "Copy image prompt" side option under a drawn figure: one click copies
 * the prompt, a short toast says where to paste it, and the prompt itself
 * can be opened and read. Keyboard and screen readers reach every control.
 */
export function ImagePromptAction({ prompt }: { prompt: string }) {
	const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

	useEffect(() => {
		if (status === "idle") return;
		const timer = window.setTimeout(() => setStatus("idle"), 2800);
		return () => window.clearTimeout(timer);
	}, [status]);

	const onCopy = async () => {
		setStatus((await copyText(prompt)) ? "copied" : "failed");
	};

	return (
		<div className="mt-3 flex flex-col gap-2 text-sm" data-testid="image-prompt-action">
			<div className="flex flex-wrap items-center gap-2">
				<button
					type="button"
					onClick={onCopy}
					data-testid="visual-copy-prompt"
					className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
				>
					<CopyIcon className="size-3.5" aria-hidden="true" />
					Copy image prompt
				</button>
				<a
					href={IMAGE_AI_URL}
					target="_blank"
					rel="noopener noreferrer"
					className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
				>
					Open Gemini
					<ExternalLinkIcon className="size-3" aria-hidden="true" />
					<span className="sr-only">(opens in a new tab)</span>
				</a>
				<span
					role="status"
					aria-live="polite"
					data-testid="visual-copy-toast"
					className={`text-xs text-muted-foreground transition-opacity motion-reduce:transition-none ${status === "idle" ? "opacity-0" : "opacity-100"}`}
				>
					{status === "copied" ? "Copied — paste it into Gemini" : status === "failed" ? "Could not copy: select the prompt below and copy it" : ""}
				</span>
			</div>
			<details className="text-xs text-muted-foreground">
				<summary className="cursor-pointer select-none hover:text-foreground">Show the prompt</summary>
				<pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted p-2.5 font-mono text-[11px] leading-relaxed text-foreground">
					{prompt}
				</pre>
			</details>
		</div>
	);
}
