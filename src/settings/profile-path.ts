export function profileFilePath(profileDir: string, filename: string): string {
  const dir = profileDir.replace(/[\\/]+$/, "");
  const separator = dir.includes("\\") ? "\\" : "/";
  return `${dir}${separator}${filename}`;
}
