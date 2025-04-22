import * as vscode from 'vscode';

// --- Constants ---
const MAX_LINES_TO_SCAN_UP = 100; // Limit how far up we search for definitions
const MAX_BLOCK_COMMENT_LINES = 50; // Limit how far up we search for block comments

// --- Regular Expressions ---

// Regex to find a variable definition line. It captures:
// 1. (Optional) Qualifiers like const, static, etc. (non-capturing group)
// 2. Type (allows basic types, pointers *, namespaces ::, templates <>)
// 3. Variable Name (ensuring it matches the hovered word)
// 4. (Optional) Array brackets []
// 5. (Optional) Initializer part (non-capturing)
// 6. (Optional) Line comment content
const VARIABLE_DEFINITION_REGEX = (varName: string): RegExp =>
    // Be careful with escaping in the final regex string
    new RegExp(
        `^\\s*` + // Start of line, optional whitespace
        `(?:(?:const|static|volatile|unsigned|signed|long|short|struct|enum|class|typename)\\s+)*` + // Optional qualifiers
        `([\\w\\*&<>:]+(?:\\s*<[^>]*>)?(?:\\s*\\*)*)` + // Type (Group 1): word chars, *, &, <>, ::, simple templates, pointer stars
        `\\s+` + // Separator space
        `(${varName})` + // Variable Name (Group 2): Exact match of hovered word
        `(\\s*\\[[^\\]]*\\])?` + // Optional Array Brackets (Group 3)
        `\\s*(?:=[^;]+)?` + // Optional initializer (non-capturing)
        `\\s*;` + // Semicolon
        `(?:\\s*\\/\\/\\s*(.*))?` + // Optional Line Comment (Group 4: content)
        `\\s*$` // Optional trailing whitespace, end of line
    );

// Simpler regex to check if a line *looks like* a variable definition (for sequence check)
const LIKELY_DEFINITION_REGEX = /^\s*(?:(?:const|static|volatile|unsigned|signed|long|short|struct|enum|class|typename)\s+)*[\w\*\&<>:]+(?:\s*<[^>]*>)?(?:\s*\*)*\s+\w+(?:\s*\[[^\]]*\])?\s*(?:=.*)?;/;

// Regex to find the start of a block comment
const BLOCK_COMMENT_START_REGEX = /^\s*\/\*/;
// Regex to find the end of a block comment
const BLOCK_COMMENT_END_REGEX = /\*\/$/;

// --- Helper Functions ---

/**
 * Cleans block comment lines by removing delimiters and leading asterisks.
 */
function cleanBlockComment(lines: string[]): string {
    if (!lines || lines.length === 0) {
        return '';
    }
    return lines.map((line, index) => {
        let cleanedLine = line.trim();
        if (index === 0) {
            cleanedLine = cleanedLine.replace(/^\/\*+/, ''); // Remove leading /*
        }
        if (index === lines.length - 1) {
            cleanedLine = cleanedLine.replace(/\*+\/$/, ''); // Remove trailing */
        }
        cleanedLine = cleanedLine.replace(/^\s*\*/, ''); // Remove leading *
        return cleanedLine.trim();
    })
    .filter(line => line.length > 0) // Remove empty lines after cleaning
    .join('\n'); // Join with newlines
}


// --- Hover Provider Implementation ---

class HoverDocProvider implements vscode.HoverProvider {

    public async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | undefined> {

        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return undefined; // Not hovering over a word
        }
        const hoveredWord = document.getText(wordRange);
        if (!hoveredWord || /^\d+$/.test(hoveredWord)) {
            return undefined; // Ignore numbers or empty strings
        }

        let definitionLineNum = -1;
        let varType: string | undefined = undefined;
        let lineComment: string | undefined = undefined;
        let definitionRange: vscode.Range | undefined = undefined;

        // 1. Scan upwards from the current position to find the definition
        for (let lineIdx = position.line; lineIdx >= 0 && lineIdx >= position.line - MAX_LINES_TO_SCAN_UP; lineIdx--) {
            if (token.isCancellationRequested) return undefined; // Check for cancellation

            const lineText = document.lineAt(lineIdx).text;
            const definitionRegex = VARIABLE_DEFINITION_REGEX(hoveredWord);
            const match = lineText.match(definitionRegex);

            if (match) {
                // Found a potential definition line, verify the hovered word is the variable name
                const varNameInMatch = match[2]; // Group 2 is the variable name
                const typeInMatch = match[1].trim(); // Group 1 is the type
                const arrayBrackets = match[3] || ''; // Group 3 is array brackets
                const commentInMatch = match[4]?.trim(); // Group 4 is line comment content

                // Basic check to find the column range of the variable name in the matched line
                const nameStartIndex = lineText.indexOf(varNameInMatch, typeInMatch.length > 0 ? lineText.indexOf(typeInMatch) + typeInMatch.length : 0);
                if (nameStartIndex !== -1) {
                    const nameEndIndex = nameStartIndex + varNameInMatch.length;
                    const potentialDefRange = new vscode.Range(lineIdx, nameStartIndex, lineIdx, nameEndIndex);

                    // More robust check: Does the found variable name contain the original hover position?
                    // Or, if hovering on the definition line, does the word range match?
                     // Let's simplify: if we found the definition by scanning up, accept it.
                     // A more complex system would use language servers or ASTs.
                     // We assume if we find `type hoveredWord;` above, it's the definition.

                    definitionLineNum = lineIdx;
                    varType = typeInMatch + arrayBrackets; // Combine type and array part
                    lineComment = commentInMatch;
                    definitionRange = potentialDefRange; // Store the range of the defined variable name
                    break; // Stop searching once definition found
                }
            }
             // Optimization: Stop searching upwards if we hit what looks like a function start or end of file scope
             if (lineText.trim() === '{' || lineText.trim() === '}' || lineText.trim().startsWith('#include') || lineText.trim().startsWith('#define')) {
                // Heuristic: Stop if we likely exited the local scope or entered global/preprocessing scope
                // This is very basic scope awareness.
                // break; // Removed break here to allow finding globals defined higher up. Add back if causing issues.
             }
        }

        // 2. If no definition found nearby, abort
        if (definitionLineNum === -1 || !varType || !definitionRange) {
            return undefined;
        }

        // 3. Check if the definition is the first in a sequence
        let isFirstInSequence = true;
        if (definitionLineNum > 0) {
            const prevLineText = document.lineAt(definitionLineNum - 1).text;
            if (LIKELY_DEFINITION_REGEX.test(prevLineText.trim())) {
                isFirstInSequence = false;
            }
        }

        // 4. Find the preceding block comment /* ... */ (only if first in sequence)
        let blockComment: string | undefined = undefined;
        if (isFirstInSequence && definitionLineNum > 0) {
            const blockCommentEndLineNum = definitionLineNum - 1;
            const blockCommentEndLineText = document.lineAt(blockCommentEndLineNum).text.trim();

            if (BLOCK_COMMENT_END_REGEX.test(blockCommentEndLineText)) {
                const commentLines: string[] = [];
                let currentCommentLine = blockCommentEndLineNum;
                let searchLines = 0; // Limit search depth

                while (currentCommentLine >= 0 && searchLines < MAX_BLOCK_COMMENT_LINES) {
                    if (token.isCancellationRequested) return undefined;

                    const line = document.lineAt(currentCommentLine).text;
                    commentLines.unshift(line); // Add to the beginning

                    if (BLOCK_COMMENT_START_REGEX.test(line.trim())) {
                        blockComment = cleanBlockComment(commentLines);
                        break; // Found the start
                    }
                    currentCommentLine--;
                    searchLines++;
                }
            }
        }

        // 5. Construct the Markdown Hover content
        const hoverContent = new vscode.MarkdownString('', true); // Enable markdown
        hoverContent.supportThemeIcons = true; // Allow icons like $(symbol-variable)

        let contentAdded = false;

        // Add block comment if found
        if (blockComment) {
            // Using appendMarkdown allows potential markdown within the comment itself
            hoverContent.appendMarkdown(blockComment);
            contentAdded = true;
        }

        // Add type and line comment
        if (varType) {
            if (contentAdded) {
                 hoverContent.appendMarkdown('\n\n---\n\n'); // Add separator if block comment exists
            }
            // Use code block for type to hint at syntax highlighting
            hoverContent.appendCodeblock(varType, 'c'); // Specify language as 'c' (or 'cpp')
            if (lineComment) {
                hoverContent.appendText(`${lineComment}`); // Append line comment as plain text
            }
            contentAdded = true;
        }

        // 6. Return the Hover object only if content was added
        if (contentAdded) {
            // Return the hover object, applying it to the range of the variable *definition* we found
            return new vscode.Hover(hoverContent, definitionRange);
        } else {
            return undefined; // No relevant info found
        }
    }
}


// --- Extension Activation ---

export function activate(context: vscode.ExtensionContext) {

    console.log('Extension "hover-docs" is now active.');

    // Register the HoverProvider for C and C++ files
    const hoverProvider = vscode.languages.registerHoverProvider(
        ['c', 'cpp', 'h', 'hpp'], // Apply to these language IDs
        new HoverDocProvider()
    );

    // Add the provider to the context's subscriptions so it's disposed automatically
    context.subscriptions.push(hoverProvider);
}

// --- Extension Deactivation ---

export function deactivate() {
    console.log('Extension "hover-docs" is now deactivated.');
}
