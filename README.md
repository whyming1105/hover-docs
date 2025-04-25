# hover-docs

Enhanced hover documentation for C/C++ variables

## Features

- Detailed hover documentation for C/C++ code
- Display variable types and definition locations
- Supports C and C++ header files (.h, .hpp)
- ** NEW **: Support hover comment display for cross-file parsing
  - Comments can also be displayed when using struct members defined in.h files in.c files
  - Automatically searches the workspace for header files

## Installation

1. Install from VS Code Marketplace
2. Reload VS Code window

## Usage

Hover the mouse over any variable in C/C++ code to view the enhanced documentation.

### Cross-file hover comment

New feature supports variable display comments defined in different files:

1. When using struct members defined in.h files in.c files, hovering can also display comments in the original code
2. The plug-in automatically searches the workspace for the included header file to find the original definition of the variable
3. The hover prompt displays the definition file path, type, and comment for the variable

**Example**：

```c
// Structure defined in header.h file
struct myStruct {
    int ex1;        // Examples 1
    float ex2;      // Examples 2
    char ex3;       // Examples 3
} mst;

// Used in main.c file
void function() {
    mst.ex1 = 7;    // Hovering will display the original annotation "Example 1"
    mst.ex2 = 5.5;  // Hovering will display the original annotation "Example 2"
    mst.ex3 = 'A';  // Hovering will display the original annotation "Example 3"
}
```

## Requirements

- VS Code 1.99.0 or higher

## Extension Settings

No additional settings required.

## Known Issues

None currently.

## Release Notes

### 0.0.3

- Add cross-file hover comment
- Supports automatic search for included header files in the workspace
- Optimize hover display format

### 0.0.2

- Fixed some bugs.
- Improved variable type recognition

### 0.0.1

- original version was
- Basic C/C++ variable hovering functionality