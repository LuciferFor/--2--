export function escapeXml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export function statBlock(label: string, value: string | number, x: number, y: number): string {
  return `
    <g transform="translate(${x}, ${y})">
      <text class="stat-label" x="0" y="0">${escapeXml(label)}</text>
      <text class="stat-value" x="0" y="38">${escapeXml(value)}</text>
    </g>
  `;
}
