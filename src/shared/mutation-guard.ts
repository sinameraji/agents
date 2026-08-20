/**
 * The one mutating-shell-command detector, shared by every harness that gates writes (the aisdk
 * bridge adapter and the DO-side cfagent loop). Two patterns because \b can't sit next to
 * whitespace or punctuation: redirects (>, >>) need their own test, and interpreter/installer
 * escapes (python -c 'open(...,"w")', git apply, dd) need explicit entries.
 */
export function isMutatingCommand(command: string): boolean {
  const redirect = /(^|[\s;|&])>{1,2}/.test(command)
  const mutating =
    /\b(rm|mv|cp|touch|mkdir|chmod|chown|ln|tee|truncate|dd|sed\s+-i|git\s+(commit|push|apply|checkout|reset|clean)|npm\s+(i|install|ci|update)|pip3?\s+install|apt(-get)?\s+install|(python3?|node|perl|ruby)\s+-[ce])\b/.test(
      command,
    )
  return redirect || mutating
}
