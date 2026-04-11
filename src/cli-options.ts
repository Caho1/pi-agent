export interface CliOptions {
  showHelp: boolean;
  prompt: string;
}

export function parseCliArgs(argv: string[]): CliOptions {
  const showHelp = argv.includes("--help") || argv.includes("-h");
  if (showHelp) {
    return {
      showHelp: true,
      prompt: ""
    };
  }

  return {
    showHelp: false,
    prompt: argv.join(" ").trim()
  };
}
