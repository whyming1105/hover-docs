import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// --- Constants ---
const MAX_LINES_TO_SCAN_UP = 100; // Limit how far up we search for definitions
const MAX_BLOCK_COMMENT_LINES = 50; // Limit how far up we search for block comments
const MAX_FILES_TO_SEARCH = 20; // Limit how many files we search for cross-file definitions

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

    /**
     * Find variable definition in a specific document
     * @param document The document to search in
     * @param hoveredWord The variable name to search for
     * @param token Cancellation token
     * @param startLine Optional starting line to search from
     * @param endLine Optional ending line to search to
     * @returns Definition information or undefined if not found
     */
    private findDefinitionInDocument(
        document: vscode.TextDocument,
        hoveredWord: string,
        token: vscode.CancellationToken,
        startLine: number = 0,
        endLine: number = document.lineCount - 1
    ): { lineNum: number, varType: string, lineComment: string | undefined, range: vscode.Range } | undefined {
        for (let lineIdx = startLine; lineIdx <= endLine; lineIdx++) {
            if (token.isCancellationRequested) {return undefined;}

            const lineText = document.lineAt(lineIdx).text;
            const definitionRegex = VARIABLE_DEFINITION_REGEX(hoveredWord);
            const match = lineText.match(definitionRegex);

            if (match) {
                // Found a potential definition line
                const varNameInMatch = match[2]; // Group 2 is the variable name
                const typeInMatch = match[1].trim(); // Group 1 is the type
                const arrayBrackets = match[3] || ''; // Group 3 is array brackets
                const commentInMatch = match[4]?.trim(); // Group 4 is line comment content

                // Find the column range of the variable name in the matched line
                const nameStartIndex = lineText.indexOf(varNameInMatch, typeInMatch.length > 0 ? lineText.indexOf(typeInMatch) + typeInMatch.length : 0);
                if (nameStartIndex !== -1) {
                    const nameEndIndex = nameStartIndex + varNameInMatch.length;
                    const definitionRange = new vscode.Range(lineIdx, nameStartIndex, lineIdx, nameEndIndex);

                    return {
                        lineNum: lineIdx,
                        varType: typeInMatch + arrayBrackets, // Combine type and array part
                        lineComment: commentInMatch,
                        range: definitionRange
                    };
                }
            }
        }

        return undefined; // No definition found
    }

    /**
     * Find block comment preceding a definition line
     * @param document The document to search in
     * @param definitionLineNum The line number of the definition
     * @param token Cancellation token
     * @returns Block comment text or undefined if not found
     */
    private findBlockComment(
        document: vscode.TextDocument,
        definitionLineNum: number,
        token: vscode.CancellationToken
    ): string | undefined {
        // Check if the definition is the first in a sequence
        let isFirstInSequence = true;
        if (definitionLineNum > 0) {
            const prevLineText = document.lineAt(definitionLineNum - 1).text;
            if (LIKELY_DEFINITION_REGEX.test(prevLineText.trim())) {
                isFirstInSequence = false;
            }
        }

        // Only look for block comments if this is the first in a sequence
        if (!isFirstInSequence || definitionLineNum <= 0) {
            return undefined;
        }

        const blockCommentEndLineNum = definitionLineNum - 1;
        const blockCommentEndLineText = document.lineAt(blockCommentEndLineNum).text.trim();

        if (BLOCK_COMMENT_END_REGEX.test(blockCommentEndLineText)) {
            const commentLines: string[] = [];
            let currentCommentLine = blockCommentEndLineNum;
            let searchLines = 0; // Limit search depth

            while (currentCommentLine >= 0 && searchLines < MAX_BLOCK_COMMENT_LINES) {
                if (token.isCancellationRequested) {return undefined;}

                const line = document.lineAt(currentCommentLine).text;
                commentLines.unshift(line); // Add to the beginning

                if (BLOCK_COMMENT_START_REGEX.test(line.trim())) {
                    return cleanBlockComment(commentLines);
                }
                currentCommentLine--;
                searchLines++;
            }
        }

        return undefined;
    }

    /**
     * Find included header files in the current document
     * @param document The document to search in
     * @returns Array of potential header file paths
     */
    private findIncludedFiles(document: vscode.TextDocument): string[] {
        const includeRegex = /^\s*#include\s+[<"]([^>"]+)[>"].*$/;
        const includedFiles: string[] = [];
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        
        if (!workspaceFolder) {
            return [];
        }

        // Scan the document for #include statements
        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i).text;
            const match = line.match(includeRegex);
            
            if (match && match[1]) {
                const includePath = match[1];
                includedFiles.push(includePath);
            }
        }

        return includedFiles;
    }

    /**
     * Find potential header files in the workspace that might contain the definition
     * @param document Current document
     * @param hoveredWord Variable name to search for
     * @returns Array of document URIs that might contain the definition
     */
    private async findPotentialHeaderFiles(document: vscode.TextDocument, hoveredWord: string): Promise<vscode.Uri[]> {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        if (!workspaceFolder) {
            return [];
        }

        // First, check explicitly included files from the current document
        const includedFiles = this.findIncludedFiles(document);
        const potentialFiles: vscode.Uri[] = [];
        
        // Try to find the actual files in the workspace
        for (const includeFile of includedFiles) {
            // For system includes like <stdio.h>, we can't easily find them
            // For project includes like "myheader.h", we can try to find them
            const fileName = path.basename(includeFile);
            
            // Search for this file in the workspace
            const fileMatches = await vscode.workspace.findFiles(
                `**/${fileName}`, 
                '**/node_modules/**', 
                MAX_FILES_TO_SEARCH
            );
            
            potentialFiles.push(...fileMatches);
        }
        
        // Also search for any .h files that might contain our variable name
        // This is a fallback for when includes don't directly match
        const headerFiles = await vscode.workspace.findFiles(
            '**/*.{h,hpp}',
            '**/node_modules/**',
            MAX_FILES_TO_SEARCH
        );
        
        // Add any header files not already in our list
        for (const headerFile of headerFiles) {
            if (!potentialFiles.some(file => file.fsPath === headerFile.fsPath)) {
                potentialFiles.push(headerFile);
            }
        }
        
        return potentialFiles;
    }

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

        // First, try to find the definition in the current document
        let definitionInfo = this.findDefinitionInDocument(
            document,
            hoveredWord,
            token,
            Math.max(0, position.line - MAX_LINES_TO_SCAN_UP),
            position.line
        );

        let sourceDocument = document;
        let blockComment: string | undefined = undefined;

        // If not found in current document, search in other files
        if (!definitionInfo) {
            // Look for the definition in potential header files
            const headerFiles = await this.findPotentialHeaderFiles(document, hoveredWord);
            
            for (const headerFile of headerFiles) {
                if (token.isCancellationRequested) {return undefined;}
                
                try {
                    // Open the header file and search for the definition
                    const headerDocument = await vscode.workspace.openTextDocument(headerFile);
                    const headerDefinition = this.findDefinitionInDocument(headerDocument, hoveredWord, token);
                    
                    if (headerDefinition) {
                        definitionInfo = headerDefinition;
                        sourceDocument = headerDocument;
                        break;
                    }
                } catch (error) {
                    console.error(`Error opening file ${headerFile.fsPath}:`, error);
                }
            }
        }

        // If still no definition found, abort
        if (!definitionInfo) {
            return undefined;
        }

        // Find block comment for the definition
        blockComment = this.findBlockComment(sourceDocument, definitionInfo.lineNum, token);

        // 5. Construct the Markdown Hover content
        const hoverContent = new vscode.MarkdownString('', true); // Enable markdown
        hoverContent.supportThemeIcons = true; // Allow icons like $(symbol-variable)

        let contentAdded = false;

        // Add source file information if it's from a different file
        if (sourceDocument.uri.fsPath !== document.uri.fsPath) {
            const relativePath = path.relative(
                vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath || '',
                sourceDocument.uri.fsPath
            );
            hoverContent.appendMarkdown(`*定义于 [${relativePath}](${sourceDocument.uri.toString()})*\n\n`);
            contentAdded = true;
        }

        // Add block comment if found
        if (blockComment) {
            if (contentAdded) {
                hoverContent.appendMarkdown('\n');
            }
            // Using appendMarkdown allows potential markdown within the comment itself
            hoverContent.appendMarkdown(blockComment);
            contentAdded = true;
        }

        // Add type and line comment
        if (definitionInfo.varType) {
            if (contentAdded) {
                 hoverContent.appendMarkdown('\n\n---\n\n'); // Add separator if block comment exists
            }
            // Use code block for type to hint at syntax highlighting
            hoverContent.appendCodeblock(definitionInfo.varType, 'c'); // Specify language as 'c' (or 'cpp')
            if (definitionInfo.lineComment) {
                hoverContent.appendText(`${definitionInfo.lineComment}`); // Append line comment as plain text
            }
            contentAdded = true;
        }

        // 6. Return the Hover object only if content was added
        if (contentAdded) {
            // Return the hover object, applying it to the range of the variable *definition* we found
            return new vscode.Hover(hoverContent, definitionInfo.range);
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

    // Register the command to show extension info
    const showInfoCommand = vscode.commands.registerCommand('hover-docs.showInfo', () => {
        vscode.window.showInformationMessage('C/C++悬停文档插件已激活，将鼠标悬停在变量上即可查看增强文档。');
    });

    // Add the provider and command to the context's subscriptions so they're disposed automatically
    context.subscriptions.push(hoverProvider, showInfoCommand);
}

// --- Extension Deactivation ---

export function deactivate() {
    console.log('Extension "hover-docs" is now deactivated.');
}
