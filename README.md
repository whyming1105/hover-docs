# hover-docs

Enhanced hover documentation for C/C++ variables

## Features

- 为C/C++代码提供详细的悬停文档
- 显示变量类型和定义位置
- 支持C和C++头文件(.h, .hpp)
- **新功能**: 支持跨文件解析的悬停注释显示
  - 当在.c文件中使用.h文件中定义的结构体成员时，也能显示注释
  - 自动在工作区中搜索包含的头文件

## Installation

1. Install from VS Code Marketplace
2. Reload VS Code window

## Usage

只需将鼠标悬停在C/C++代码中的任何变量上，即可查看增强的文档。

### 跨文件悬停注释

新功能支持在不同文件中定义的变量显示注释：

1. 当在.c文件中使用.h文件中定义的结构体成员时，悬停也能显示原始代码中的注释
2. 插件会自动在工作区中搜索包含的头文件，找到变量的原始定义
3. 悬停提示会显示变量的定义文件路径、类型和注释

**示例**：

```c
// header.h 文件中定义结构体
struct myStruct {
    int ex1;        // 示例1
    float ex2;      // 示例2
    char ex3;       // 示例3
} mst;

// main.c 文件中使用
void function() {
    mst.ex1 = 7;    // 悬停时会显示原始注释 “示例1”
    mst.ex2 = 5.5;  // 悬停时会显示原始注释 “示例2”
    mst.ex3 = 'A';  // 悬停时会显示原始注释 “示例3”
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

- 添加跨文件悬停注释功能
- 支持在工作区中自动搜索包含的头文件
- 优化悬停显示格式

### 0.0.2

- 修复了一些bug
- 改进了变量类型识别

### 0.0.1

- 初始版本发布
- 基本的C/C++变量悬停功能