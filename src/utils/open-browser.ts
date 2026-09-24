import { spawn } from "node:child_process";
import { platform } from "node:os";

/** Open a URL in the default browser without keeping the server process attached. */
export function openBrowser(url: string, onError: () => void): void {
  const os = platform();
  const command = os === "darwin" ? "open" : os === "win32" ? "explorer" : "xdg-open";
  const child = spawn(command, [url], { detached: true, stdio: "ignore" });
  child.on("error", onError);
  child.unref();
}
