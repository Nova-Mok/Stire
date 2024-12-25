// extension.js
const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

/**
 * Escapes HTML characters to prevent XSS.
 * @param {string} unsafe - The string to escape.
 * @returns {string} - The escaped string.
 */
function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * Sanitizes a string to be used as an HTML element ID.
 * @param {string} str - The string to sanitize.
 * @returns {string} - The sanitized string.
 */
function sanitizeForId(str) {
    return str.replace(/[^a-zA-Z0-9_-]/g, "_");
}

class FileTreeProvider {
    constructor(workspaceRoot) {
        this.workspaceRoot = workspaceRoot;
        // Excluded files/folders for the sidebar "Stire Structure" view
        this.excludeFolders = [
            ".git",
            "node_modules",
            ".vscode",
            "dist",
            "build",
            "out",
            "test.*",
            "venv",
            "env",
            "static/build/",
            "__pycache__",
            "clones",
            "src/__pycache__/",
            "*.sarf",
            "build/",
            "dist/",
            "*.egg-info/",
            ".DS_Store",
            ".exe",
            ".dll",
            ".bin",
            ".so",
            ".jpg",
            ".jpeg",
            ".png",
            ".gif",
            ".ico",
            ".svg",
            ".mov",
            ".mp4",
            ".mp3",
            ".avi",
            ".mkv",
            ".webm",
            ".wav",
            ".flac",
            ".ogg",
            ".pdf",
            ".doc",
            ".docx",
            ".ppt",
            ".pptx",
            ".xls",
            ".xlsx",
            ".zip",
            ".rar",
            ".tar",
            ".gz",
            ".7z",
            ".iso",
            ".log",
            ".tmp",
            ".bak",
            ".swp",
            ".class",
            ".jar",
            ".war",
            ".keep"
        ];
    }

    getTreeItem(element) {
        return element;
    }

    getChildren(element) {
        if (!this.workspaceRoot) {
            vscode.window.showInformationMessage("No workspace folder open");
            return Promise.resolve([]);
        }
        const dir = element ? element.resourceUri.fsPath : this.workspaceRoot;
        return Promise.resolve(this.readDirectory(dir));
    }

    readDirectory(dir) {
        let children;
        try {
            children = fs.readdirSync(dir);
        } catch (error) {
            vscode.window.showErrorMessage(`Unable to read directory: ${dir}`);
            return [];
        }

        return children
            .filter((child) => !this.excludeFolders.includes(child))
            .map((child) => {
                const childPath = path.join(dir, child);
                let isDirectory = false;
                try {
                    isDirectory = fs.statSync(childPath).isDirectory();
                } catch (error) {
                    vscode.window.showErrorMessage(`Unable to access: ${childPath}`);
                }

                const treeItem = new vscode.TreeItem(
                    child,
                    isDirectory
                        ? vscode.TreeItemCollapsibleState.Collapsed
                        : vscode.TreeItemCollapsibleState.None
                );
                treeItem.resourceUri = vscode.Uri.file(childPath);

                if (isDirectory) {
                    treeItem.command = {
                        command: "fileTreeView.copyFolderOnClick",
                        title: "Stire: Copy Folder Structure on Click",
                        arguments: [treeItem],
                    };
                }

                return treeItem;
            });
    }

    /**
     * Generates folder structure with file contents.
     * @param {string} folderPath
     * @returns {string}
     */
    generateFolderStructureWithContents(folderPath) {
        const readStructure = (dir, indent = "") => {
            let result = "";
            let entries;
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch (error) {
                vscode.window.showErrorMessage(`Unable to read directory: ${dir}`);
                return result;
            }

            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);

                if (entry.isDirectory()) {
                    result += `${indent}📁 ${entry.name}\n`;
                    result += readStructure(fullPath, indent + "  ");
                } else {
                    let content = "";
                    try {
                        content = fs.readFileSync(fullPath, "utf-8");
                    } catch (error) {
                        content = "Unable to read file contents.";
                    }
                    result += `${indent}📄 ${entry.name}\n`;
                    result += `${indent}  ${content
                        .split("\n")
                        .map((line) => `${indent}  ${line}`)
                        .join("\n")}\n`;
                }
            }

            return result;
        };

        return readStructure(folderPath);
    }

    /**
     * Generates folder structure without file contents.
     * @param {string} folderPath
     * @returns {string}
     */
    generateFolderStructureOnly(folderPath) {
        const readStructure = (dir, indent = "") => {
            let result = "";
            let entries;
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch (error) {
                vscode.window.showErrorMessage(`Unable to read directory: ${dir}`);
                return result;
            }

            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);

                if (entry.isDirectory()) {
                    result += `${indent}📁 ${entry.name}\n`;
                    result += readStructure(fullPath, indent + "  ");
                } else {
                    result += `${indent}📄 ${entry.name}\n`;
                }
            }

            return result;
        };

        return readStructure(folderPath);
    }
}

class StierAIAskProvider {
    constructor(context, fileTreeProvider, workspaceRoot) {
        this.context = context;
        this.fileTreeProvider = fileTreeProvider;
        this.workspaceRoot = workspaceRoot;
        this.panel = null;
        this.selectedFiles = [];
    }

    createOrShow() {
        const column = vscode.ViewColumn.One;
        if (this.panel) {
            this.panel.reveal(column);
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            "stireAIAsk",
            "Stire AI Ask",
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.file(path.join(this.context.extensionPath, 'media'))]
            }
        );

        // Load the HTML content from the separate file
        const htmlPath = path.join(this.context.extensionPath, 'media', 'stierAIAsk.html');
        let htmlContent = fs.readFileSync(htmlPath, 'utf8');

        // 1) Gather all user files
        const files = this.getUserFiles(this.workspaceRoot);

        // 2) Convert them into a JSON string so the HTML can build a tree
        const filePathsJson = JSON.stringify(files).replace(/"/g, '\\"');

        // 3) Insert into the HTML
        //    The new HTML expects {{FILE_PATH_JSON}} placeholder for the array
        htmlContent = htmlContent.replace("{{FILE_PATH_JSON}}", filePathsJson);

        // Set the webview’s HTML
        this.panel.webview.html = htmlContent;

        this.panel.onDidDispose(() => {
            this.panel = null;
        });

        // Handle messages from the Webview
        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case "askQuestion":
                        await this.handleAskQuestion(message.text, message.selectedFiles);
                        break;
                    case "setApiKey":
                        await this.handleSetApiKey();
                        break;
                    case "toggleFileSelection":
                        this.toggleFileSelection(message.filePath);
                        break;
                    case "showToast":
                        // If the UI wants to show a toast in VS Code
                        vscode.window.showInformationMessage(message.message);
                        break;
                }
            },
            undefined,
            this.context.subscriptions
        );
    }

    /**
     * Recursively fetches user-generated files from the workspace.
     * You can still rely on the "excludeFolders" from fileTreeProvider if you like,
     * or do a custom filter here. For simplicity, let’s just gather all for now.
     * 
     * @param {string} dir
     * @returns {string[]}
     */
	getUserFiles(dir) {
		let results = [];
		if (!dir) return results;
	
		// Define folder names to exclude
		const excludeFolders = [
			"node_modules",
			".git",
			".vscode",
			"dist",
			"build",
			"out",
			"__pycache__",
			".DS_Store",
			"assets",
			"Images"
			// etc. Add more if needed
		];
	
		// Define file extensions to exclude (images, videos, etc.)
		const excludeFileExtensions = [
			".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg",
			".mov", ".mp4", ".mp3", ".avi", ".mkv", ".webm",
			".wav", ".flac", ".ogg"
			// etc. Add more if needed
		];
	
		let list;
		try {
			list = fs.readdirSync(dir);
		} catch (error) {
			vscode.window.showErrorMessage(`Unable to read directory: ${dir}`);
			return results;
		}
	
		for (const file of list) {
			const filePath = path.join(dir, file);
			let stat;
			try {
				stat = fs.statSync(filePath);
			} catch {
				continue; // skip if can't stat
			}
	
			// Get just the base name (folder or file name)
			const baseName = path.basename(filePath);
	
			// 1) Skip excluded folders
			if (stat.isDirectory()) {
				if (excludeFolders.includes(baseName)) {
					// Skip these folders entirely
					continue;
				}
				// Otherwise, recurse
				results = results.concat(this.getUserFiles(filePath));
			} else {
				// 2) Skip files with excluded extensions
				// e.g. skip .png, .jpg, etc.
				const lowerName = baseName.toLowerCase();
				if (excludeFileExtensions.some(ext => lowerName.endsWith(ext))) {
					continue;
				}
				// If it passes all checks, we store it
				results.push(path.relative(this.workspaceRoot, filePath));
			}
		}
		return results;
	}
	

    /**
     * Toggles the selection of a file from the webview’s tree.
     */
    toggleFileSelection(filePath) {
        const index = this.selectedFiles.indexOf(filePath);
        if (index > -1) {
            this.selectedFiles.splice(index, 1);
        } else {
            this.selectedFiles.push(filePath);
        }
    }

    /**
     * Handles the user's question by sending it to OpenAI and displaying the response.
     * @param {string} question
     * @param {string[]} selectedFiles
     */
    async handleAskQuestion(question, selectedFiles) {
        const config = vscode.workspace.getConfiguration().get("stierAI");
        const apiKey = config.openaiApiKey;
        const model = config.openaiModel;

        // If no API key, prompt user to set it
        if (!apiKey) {
            this.panel.webview.postMessage({ command: "promptApiKey" });
            return;
        }

        // Construct context code
        let contextCode = "";
        if (selectedFiles && selectedFiles.length > 0) {
            // If the user explicitly selected files
            selectedFiles.forEach((file) => {
                const fullPath = path.join(this.workspaceRoot, file);
                try {
                    const content = fs.readFileSync(fullPath, "utf-8");
                    contextCode += `// File: ${file}\n${content}\n\n`;
                } catch (error) {
                    contextCode += `// File: ${file}\nUnable to read file contents.\n\n`;
                }
            });
        } else {
            // If no files selected, show entire folder structure only
            contextCode = `Workspace Structure:\n${this.fileTreeProvider.generateFolderStructureOnly(
                this.workspaceRoot
            )}\n\n`;
        }

        // Build the prompt
        let prompt = "";
        if (model.startsWith("gpt-")) {
            prompt = `Context:\n${contextCode}\nQuestion: ${question}\nAnswer:`;
        } else {
            prompt = `${contextCode}\nQuestion: ${question}\nAnswer:`;
        }

        console.log("Prompt sent to OpenAI:", prompt);

        // Call OpenAI
        try {
            let answer;
            if (model.startsWith("gpt-")) {
                // GPT-3.5 or GPT-4 Chat
                const response = await axios.post(
                    "https://api.openai.com/v1/chat/completions",
                    {
                        model: model,
                        messages: [
                            {
                                role: "system",
                                content:
                                    "You are a coding assistant and expert code reviewer. Your role is to carefully analyze the user's code, identify any issues such as bugs, inefficiencies, or poor practices, and provide clear, actionable feedback with code. Additionally, you help the user fix their code by offering optimized and well-explained solutions, while ensuring best practices and readability."
                            },
                            { role: "user", content: prompt },
                        ],
                        max_tokens: 1000,
                        temperature: 0.3,
                    },
                    {
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${apiKey}`,
                        },
                    }
                );
                answer = response.data.choices[0].message.content.trim();
            } else {
                // text-davinci-003 style completions
                const response = await axios.post(
                    "https://api.openai.com/v1/completions",
                    {
                        model: model,
                        prompt: prompt,
                        max_tokens: 150,
                        temperature: 0.5,
                    },
                    {
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${apiKey}`,
                        },
                    }
                );
                answer = response.data.choices[0].text.trim();
            }

            // Send the answer back to the webview
            this.panel.webview.postMessage({
                command: "displayResponse",
                text: answer,
            });
        } catch (error) {
            console.error("OpenAI API Error:", error);

            if (error.response) {
                const status = error.response.status;
                const statusText = error.response.statusText;
                const responseData = error.response.data;

                vscode.window.showErrorMessage(
                    `OpenAI API Error ${status}: ${statusText}`
                );
                console.error("Response Data:", responseData);
            } else if (error.request) {
                vscode.window.showErrorMessage("No response from OpenAI API.");
                console.error("Request:", error.request);
            } else {
                vscode.window.showErrorMessage(`Error: ${error.message}`);
                console.error("Error Message:", error.message);
            }

            this.panel.webview.postMessage({
                command: "displayResponse",
                text: "Error: Unable to fetch response from OpenAI.",
            });
        }
    }

    async handleSetApiKey() {
        const apiKey = await vscode.window.showInputBox({
            prompt: "Enter your OpenAI API Key",
            ignoreFocusOut: true,
            password: true,
        });

        if (apiKey) {
            await vscode.workspace
                .getConfiguration()
                .update(
                    "stierAI.openaiApiKey",
                    apiKey,
                    vscode.ConfigurationTarget.Global
                );
            vscode.window.showInformationMessage(
                "OpenAI API Key has been set successfully."
            );
        } else {
            vscode.window.showWarningMessage("OpenAI API Key was not set.");
        }
    }
}

/**
 * Activates the extension.
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    console.log("Stire AI extension activated.");

    const workspaceRoot = vscode.workspace.workspaceFolders
        ? vscode.workspace.workspaceFolders[0].uri.fsPath
        : undefined;

    // 1) Provide "Stire Structure" in the sidebar
    const fileTreeProvider = new FileTreeProvider(workspaceRoot);
    vscode.window.registerTreeDataProvider("fileTreeView", fileTreeProvider);
    console.log("Registered fileTreeView data provider.");

    // Register commands for "Stire Structure"
    context.subscriptions.push(
        vscode.commands.registerCommand("fileTreeView.refresh", () => {
            fileTreeProvider.workspaceRoot = vscode.workspace.workspaceFolders
                ? vscode.workspace.workspaceFolders[0].uri.fsPath
                : undefined;
            vscode.window.showInformationMessage("Refreshing Stire AI Structure...");
            fileTreeProvider.getChildren().then(() => {
                vscode.commands.executeCommand("workbench.view.explorer");
                console.log("fileTreeView.refresh command executed.");
            });
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("fileTreeView.copyFolderOnClick", (folder) => {
            if (!folder) {
                vscode.window.showErrorMessage(
                    "Select a folder to copy its structure."
                );
                return;
            }
            const folderPath = folder.resourceUri.fsPath;
            const structure =
                fileTreeProvider.generateFolderStructureWithContents(folderPath);

            vscode.env.clipboard.writeText(structure);
            vscode.window.showInformationMessage(
                "Folder structure with file contents copied to clipboard!"
            );
            console.log("fileTreeView.copyFolderOnClick command executed.");
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("fileTreeView.copyFolderStructure", () => {
            if (!workspaceRoot) {
                vscode.window.showErrorMessage("No workspace folder open.");
                return;
            }
            const structure =
                fileTreeProvider.generateFolderStructureWithContents(workspaceRoot);

            vscode.env.clipboard.writeText(structure);
            vscode.window.showInformationMessage(
                "Folder structure with file contents copied to clipboard!"
            );
            console.log("fileTreeView.copyFolderStructure command executed.");
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("fileTreeView.copyEntireStructure", () => {
            if (!workspaceRoot) {
                vscode.window.showErrorMessage("No workspace folder open.");
                return;
            }
            const structure =
                fileTreeProvider.generateFolderStructureWithContents(workspaceRoot);

            vscode.env.clipboard.writeText(structure);
            vscode.window.showInformationMessage(
                "Entire workspace structure with file contents copied to clipboard!"
            );
            console.log("fileTreeView.copyEntireStructure command executed.");
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("fileTreeView.copyStructureOnly", () => {
            if (!workspaceRoot) {
                vscode.window.showErrorMessage("No workspace folder open.");
                return;
            }
            const structure =
                fileTreeProvider.generateFolderStructureOnly(workspaceRoot);

            vscode.env.clipboard.writeText(structure);
            vscode.window.showInformationMessage(
                "Folder structure copied to clipboard without file contents!"
            );
            console.log("fileTreeView.copyStructureOnly command executed.");
        })
    );

    // 2) Provide "Stire AI Ask" in the sidebar
    const stierAIAskProvider = new StierAIAskProvider(
        context,
        fileTreeProvider,
        workspaceRoot
    );
    vscode.window.registerTreeDataProvider("stierAIAsk", stierAIAskProvider);
    console.log("Registered stierAIAsk data provider.");

    // Register commands for Stier AI Ask
    context.subscriptions.push(
        vscode.commands.registerCommand("stierAI.askQuestion", () => {
            stierAIAskProvider.createOrShow();
            console.log("stierAI.askQuestion command executed.");
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("stierAI.setApiKey", async () => {
            const apiKey = await vscode.window.showInputBox({
                prompt: "Enter your OpenAI API Key",
                ignoreFocusOut: true,
                password: true,
            });

            if (apiKey) {
                await vscode.workspace
                    .getConfiguration()
                    .update(
                        "stierAI.openaiApiKey",
                        apiKey,
                        vscode.ConfigurationTarget.Global
                    );
                vscode.window.showInformationMessage(
                    "OpenAI API Key has been set successfully."
                );
                console.log("stierAI.setApiKey command executed.");
            } else {
                vscode.window.showWarningMessage("OpenAI API Key was not set.");
                console.log("stierAI.setApiKey command was not set.");
            }
        })
    );

    // Create Status Bar Item
    const statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    statusBarItem.command = "stierAI.askQuestion";
    statusBarItem.text = "$(robot) Stire AI";
    statusBarItem.tooltip = "Ask Stire AI a Question";
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);
    console.log("Stire AI status bar item created.");
}

function deactivate() {
    console.log("Stire AI extension deactivated.");
}

module.exports = {
    activate,
    deactivate,
};
