import Anthropic from "@anthropic-ai/sdk";
import type { DownloadedInput } from "./input-download.js";

export interface ConvertTaskParams {
  task: string;
  downloadedInputs: DownloadedInput[];
}

export interface ConvertTaskResult {
  ffmpegCommand: string;
  reasoning?: string;
}

/**
 * Converts natural language task into FFmpeg command using Claude API
 * Takes task description and downloaded input files, returns FFmpeg command
 */
export async function convertTaskToFFmpegCommand(
  params: ConvertTaskParams
): Promise<ConvertTaskResult> {
  const { task, downloadedInputs } = params;

  // Build input files context for Claude
  const inputsContext = downloadedInputs
    .map((input, index) => {
      const name = input.filename;
      return `Input ${index + 1}: ${name} (path: ${input.localPath})`;
    })
    .join("\n");

  const prompt = buildPrompt(task, inputsContext);

  // Get Claude API client
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    // Extract JSON from response
    const responseText = extractTextContent(message.content);
    const jsonText = extractJsonFromResponse(responseText);
    const parsed = JSON.parse(jsonText) as {
      command: string;
      reasoning: string;
    };

    return {
      ffmpegCommand: parsed.command,
      reasoning: parsed.reasoning,
    };
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      throw new Error(
        `Claude API error: ${err.status} - ${err.message}`
      );
    }
    throw err;
  }
}

/**
 * Builds the prompt for Claude to generate FFmpeg command
 */
function buildPrompt(task: string, inputsContext: string): string {
  return `You are an FFmpeg expert. Convert the following task into a valid FFmpeg command.

Task: ${task}

Available input files:
${inputsContext}

Requirements:
1. Generate ONLY the FFmpeg arguments (do not include 'ffmpeg' prefix)
2. Use the exact local file paths provided for input files
3. Output files should use simple filenames (e.g., output.mp4, result.wav)
4. Ensure the command is valid and will execute successfully
5. Optimize for quality and efficiency

Respond with valid JSON in this exact format:
{
  "command": "the FFmpeg arguments without ffmpeg prefix",
  "reasoning": "brief explanation of what the command does"
}`;
}

/**
 * Extracts text content from Claude API response
 */
function extractTextContent(
  content: Anthropic.Messages.ContentBlock[]
): string {
  const textBlocks = content.filter(
    (block): block is Anthropic.Messages.TextBlock => block.type === "text"
  );

  return textBlocks.map((block) => block.text).join("\n");
}

/**
 * Extracts JSON from response text, handling markdown code blocks
 * Supports both ```json...``` and plain JSON
 */
function extractJsonFromResponse(responseText: string): string {
  // Try to extract from markdown JSON code block first
  const jsonBlockMatch = responseText.match(/```json\s*\n?([\s\S]+?)\n?```/);
  if (jsonBlockMatch?.[1]) {
    return jsonBlockMatch[1].trim();
  }

  // Try generic code block
  const codeBlockMatch = responseText.match(/```\s*\n?([\s\S]+?)\n?```/);
  if (codeBlockMatch?.[1]) {
    return codeBlockMatch[1].trim();
  }

  // Otherwise return raw text (assume it's already JSON)
  return responseText.trim();
}
