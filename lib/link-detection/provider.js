"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalPathLinkProvider = void 0;
const fs_extra_1 = require("fs-extra");
const os_1 = require("os");
const path_1 = require("path");
const url_1 = require("url");
const utils_1 = require("../utils");
const path_parsing_1 = require("./path-parsing");
const MAX_VALIDATED_CANDIDATES = 50;
// Detects local filesystem paths in terminal output text and offers them up
// as xterm.js links (`Terminal.registerLinkProvider`) — a different
// mechanism from `ShellIntegrationAddon`, which parses an OSC escape-sequence
// protocol rather than scanning rendered buffer text.
//
// Candidate detection lives in `./path-parsing` (adapted from VS Code); this
// class is responsible for the xterm.js-specific parts: reading buffer text
// (joining wrapped lines so a path split across a terminal-width boundary is
// still detected — see `getWindowedLineStrings` below, adapted from
// `@xterm/addon-web-links`'s `WebLinkProvider`, Copyright (c) 2019 The
// xterm.js authors, MIT License), resolving candidates against a live cwd,
// and validating them against the real filesystem.
class LocalPathLinkProvider {
  #terminal;
  #getCwd;
  #activate;
  constructor(terminal, getCwd, activate) {
    this.#terminal = terminal;
    this.#getCwd = getCwd;
    this.#activate = activate;
  }
  provideLinks(bufferLineNumber, callback) {
    this.#provideLinks(bufferLineNumber).then(callback, () => callback(undefined));
  }
  async #provideLinks(bufferLineNumber) {
    const [lines, startLineIndex] = getWindowedLineStrings(bufferLineNumber - 1, this.#terminal);
    const text = lines.join("");
    if (!text || text.length > path_parsing_1.MAX_LINE_LENGTH) return undefined;
    const cwd = this.#getCwd();
    const links = [];
    let validatedCandidates = 0;
    // Prefer a filesystem-verified space-tolerant match over shorter regular
    // candidates. Otherwise an existing prefix (for example `C:\\foo`) can
    // steal a link from a longer path containing spaces.
    for (const matcher of path_parsing_1.fallbackPathMatchers) {
      const groups = text.match(matcher)?.groups;
      const link = groups?.link;
      const targetPath = groups?.path;
      if (!link || !targetPath || link.length > path_parsing_1.MAX_RESOLVED_LINK_LENGTH) continue;
      if (validatedCandidates++ >= MAX_VALIDATED_CANDIDATES) break;
      const resolved = await this.#resolve(targetPath, cwd);
      if (!resolved) continue;
      const startIndex = text.indexOf(link);
      const range = mapRangeToBuffer(
        this.#terminal,
        startLineIndex,
        startIndex,
        startIndex + link.length,
      );
      if (!range) continue;
      const line = groups.line ? Number(groups.line) : undefined;
      const column = groups.col ? Number(groups.col) : undefined;
      return [this.#makeLink(range, link, resolved, line, column)];
    }

    for (const parsed of (0, path_parsing_1.detectLinks)(text, (0, utils_1.isWindows)())) {
      if (parsed.path.text.length > path_parsing_1.MAX_RESOLVED_LINK_LENGTH) continue;
      if (validatedCandidates++ >= MAX_VALIDATED_CANDIDATES) break;
      const resolved = await this.#resolve(parsed.path.text, cwd);
      if (!resolved) continue;
      const startIndex = parsed.prefix?.index ?? parsed.path.index;
      const endIndex = parsed.suffix
        ? parsed.suffix.suffix.index + parsed.suffix.suffix.text.length
        : parsed.path.index + parsed.path.text.length;
      const range = mapRangeToBuffer(this.#terminal, startLineIndex, startIndex, endIndex);
      if (!range) continue;
      links.push(
        this.#makeLink(
          range,
          text.substring(startIndex, endIndex),
          resolved,
          parsed.suffix?.row,
          parsed.suffix?.col,
        ),
      );
      if (links.length >= path_parsing_1.MAX_RESOLVED_LINKS_PER_LINE) break;
    }
    return links.length > 0 ? links : undefined;
  }
  #makeLink(range, text, resolved, line, column) {
    return {
      range,
      text,
      activate: (event) =>
        this.#activate(event, resolved.absolutePath, resolved.isDirectory, line, column),
    };
  }
  async #resolve(candidatePath, cwd) {
    for (const candidate of buildPathCandidates(candidatePath, cwd)) {
      try {
        const stats = await fs_extra_1.stat(candidate);
        return { absolutePath: candidate, isDirectory: stats.isDirectory() };
      } catch {
        // Not a real path; try the next candidate.
      }
    }
    return undefined;
  }
}
exports.LocalPathLinkProvider = LocalPathLinkProvider;
// Expands a leading `~` (home directory shorthand) — but only a bare `~` or
// `~/...`, not `~otheruser`, since resolving another user's home directory
// isn't something we can do portably.
function expandTilde(candidatePath) {
  if (candidatePath === "~") return os_1.homedir();
  if (
    candidatePath.startsWith("~/") ||
    ((0, utils_1.isWindows)() && candidatePath.startsWith("~\\"))
  ) {
    return path_1.join(os_1.homedir(), candidatePath.slice(2));
  }
  return candidatePath;
}
// Builds the ordered list of paths to test against the filesystem for one
// parsed candidate: absolute paths (and `file://` URIs, and `~`-relative
// paths) are tried as-is; relative paths are resolved against the live cwd
// when known. A relative path without a cwd is ambiguous and is not linked.
function buildPathCandidates(candidatePath, cwd) {
  if (candidatePath.startsWith("file://")) {
    try {
      return [(0, url_1.fileURLToPath)(candidatePath)];
    } catch {
      return [];
    }
  }
  const expanded = expandTilde(candidatePath);
  if (path_1.isAbsolute(expanded)) return [expanded];
  return cwd ? [path_1.resolve(cwd, expanded)] : [];
}
function mapRangeToBuffer(terminal, startLineIndex, startIndex, endIndex) {
  const [startY, startX] = mapStrIdx(terminal, startLineIndex, 0, startIndex);
  const [endY, endX] = mapStrIdx(terminal, startY, startX, endIndex - startIndex);
  if (startY === -1 || startX === -1 || endY === -1 || endX === -1) return undefined;
  // Range coordinates are 1-based, end.x exclusive — see `WebLinkProvider`'s
  // `LinkComputer.computeLink`, which this mirrors.
  return {
    start: { x: startX + 1, y: startY + 1 },
    end: { x: endX, y: endY + 1 },
  };
}
// Gets the wrapped content lines around `lineIndex`, joined into a single
// string, along with the buffer index the joined string starts at. Adapted
// from `@xterm/addon-web-links`'s `WebLinkProvider._getWindowedLineStrings`.
function getWindowedLineStrings(lineIndex, terminal) {
  let line;
  let topIndex = lineIndex;
  let bottomIndex = lineIndex;
  let length;
  let content;
  const lines = [];
  if ((line = terminal.buffer.active.getLine(lineIndex))) {
    const currentContent = line.translateToString(true);
    // Expand upward, stopping at whitespace or once we've gathered enough.
    if (line.isWrapped && currentContent[0] !== " ") {
      length = 0;
      while ((line = terminal.buffer.active.getLine(--topIndex)) && length < 2048) {
        content = line.translateToString(true);
        length += content.length;
        lines.push(content);
        if (!line.isWrapped || content.indexOf(" ") !== -1) break;
      }
      lines.reverse();
    }
    lines.push(currentContent);
    // Expand downward the same way.
    length = 0;
    while (
      (line = terminal.buffer.active.getLine(++bottomIndex)) &&
      line.isWrapped &&
      length < 2048
    ) {
      content = line.translateToString(true);
      length += content.length;
      lines.push(content);
      if (content.indexOf(" ") !== -1) break;
    }
  }
  return [lines, topIndex];
}
// Maps a string index within the joined-line text back to a 0-based buffer
// position. Adapted from `WebLinkProvider._mapStrIdx`.
function mapStrIdx(terminal, lineIndex, rowIndex, stringIndex) {
  const buffer = terminal.buffer.active;
  const cell = buffer.getNullCell();
  let start = rowIndex;
  if (stringIndex === 0) return [lineIndex, start];
  while (stringIndex > 0) {
    const line = buffer.getLine(lineIndex);
    if (!line) return [-1, -1];
    for (let i = start; i < line.length; ++i) {
      line.getCell(i, cell);
      const chars = cell.getChars();
      const width = cell.getWidth();
      if (!width) continue;
      const charLength = chars.length || 1;
      if (stringIndex < charLength) return [lineIndex, i];
      stringIndex -= charLength;
      if (stringIndex !== 0) continue;
      const nextColumn = i + width;
      if (nextColumn < line.length) return [lineIndex, nextColumn];
      const nextLine = buffer.getLine(lineIndex + 1);
      if (nextLine?.isWrapped) return [lineIndex + 1, 0];
      return [lineIndex, nextColumn];
    }
    lineIndex++;
    start = 0;
  }
  return [lineIndex, start];
}
