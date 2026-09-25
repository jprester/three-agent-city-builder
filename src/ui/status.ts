const el = () => document.getElementById('status');

export function setStatus(message: string) {
  const node = el();
  if (node) node.textContent = message;
}
