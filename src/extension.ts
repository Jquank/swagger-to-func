// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode'
import { main } from './utils/common'

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log(
    'Congratulations, your extension "swagger-to-func" is now active!'
  )

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json
  let disposable = vscode.commands.registerCommand(
    'swagger-to-func.stf',
    async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders
      if (!workspaceFolders) {
        vscode.window.showErrorMessage('workspace not found')
        return
      }
      const rootPath = workspaceFolders[0].uri.fsPath

      try {
        const url = await vscode.window.showInputBox({
          value: 'http://localhost:3000/api-json',
          placeHolder: 'http://localhost:3000/api-json'
        })
        await main(rootPath, url || '')
        vscode.window.showInformationMessage('write success')
      } catch (error: any) {
        if (error && typeof error === 'object' && error.message) {
          vscode.window.showErrorMessage(error.message)
        } else {
          vscode.window.showErrorMessage('fail')
        }
      }
    }
  )

  context.subscriptions.push(disposable)

  //   const activeEditor = vscode.window.activeTextEditor
  //   if (!activeEditor) {
  //     return
  //   }
  //   vscode.commands.executeCommand<vscode.Location[]>(
  //     'swagger-to-func.stf',
  //     activeEditor.document.uri
  //   )
}

export function deactivate() {}
