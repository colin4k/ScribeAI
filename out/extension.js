'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = exports.showInputBox = void 0;
const vscode = require("vscode");
const openai_1 = require("openai");
let openai = undefined;
let commentId = 1;
class NoteComment {
    constructor(body, mode, author, parent, contextValue) {
        this.body = body;
        this.mode = mode;
        this.author = author;
        this.parent = parent;
        this.contextValue = contextValue;
        this.id = ++commentId;
        this.savedBody = this.body;
    }
}
/**
 * Shows an input box for getting API key using window.showInputBox().
 * Checks if inputted API Key is valid.
 * Updates the User Settings API Key with the newly inputted API Key.
 */
async function showInputBox() {
    const result = await vscode.window.showInputBox({
        ignoreFocusOut: true,
        placeHolder: '您的 OpenAI API Key 和 OpenAI API Base Url',
        title: 'Scribe AI',
        prompt: '请依次输入您的OpenAI API Key和OpenAI API Base Url，并用半角分号(:)分隔。',
        validateInput: async (text) => {
            vscode.window.showInformationMessage(`Validating: ${text}`);
            if (text === '') {
                return '输入不能为空';
            }
            try {
                const inputs = text.split(':');
                if (inputs[0] === '') {
                    return 'API Key 不能为空';
                }
                let _basePath = vscode.workspace.getConfiguration('scribeai').get('ApiBaseUrl');
                if (inputs[1] != '') {
                    _basePath = inputs[1];
                }
                openai = new openai_1.OpenAIApi(new openai_1.Configuration({
                    apiKey: inputs[0],
                    basePath: inputs[1] === '' ? vscode.workspace.getConfiguration('scribeai').get('ApiBaseUrl') : inputs[1],
                }));
                await openai.listModels();
            }
            catch (err) {
                return 'API key 或者 API Base Url 不正确';
            }
            return null;
        }
    });
    vscode.window.showInformationMessage(`Got: ${result}`);
    // Write to user settings
    if (result) {
        await vscode.workspace.getConfiguration('scribeai').update('ApiKey', result.split(':')[0], true);
        await vscode.workspace.getConfiguration('scribeai').update('ApiBaseUrl', result.split(':')[1], true);
    }
    // Write to workspace settings
    //await vscode.workspace.getConfiguration('scribeai').update('ApiKey', result, false);
    return result;
}
exports.showInputBox = showInputBox;
async function validateAPIKey() {
    try {
        openai = new openai_1.OpenAIApi(new openai_1.Configuration({
            apiKey: vscode.workspace.getConfiguration('scribeai').get('ApiKey'),
            basePath: vscode.workspace.getConfiguration('scribeai').get('ApiBaseUrl'),
        }));
        await openai.listModels();
    }
    catch (err) {
        return false;
    }
    return true;
}
async function activate(context) {
    // Workspace settings override User settings when getting the setting.
    if (vscode.workspace.getConfiguration('scribeai').get('ApiKey') === ""
        || !(await validateAPIKey())) {
        const apiKey = await showInputBox();
    }
    if (openai === undefined) {
        openai = new openai_1.OpenAIApi(new openai_1.Configuration({
            apiKey: vscode.workspace.getConfiguration('scribeai').get('ApiKey'),
            basePath: vscode.workspace.getConfiguration('scribeai').get('ApiBaseUrl'),
        }));
    }
    // A `CommentController` is able to provide comments for documents.
    const commentController = vscode.comments.createCommentController('comment-scribeai', 'ScribeAI Comment Controller');
    context.subscriptions.push(commentController);
    // A `CommentingRangeProvider` controls where gutter decorations that allow adding comments are shown
    commentController.commentingRangeProvider = {
        provideCommentingRanges: (document, token) => {
            const lineCount = document.lineCount;
            return [new vscode.Range(0, 0, lineCount - 1, 0)];
        }
    };
    commentController.options = {
        prompt: "询问 Scribe AI...",
        placeHolder: "可以问我任何问题! 例如: \"用简单的英语简明扼要的中文解释上述代码\""
    };
    context.subscriptions.push(vscode.commands.registerCommand('mywiki.createNote', (reply) => {
        replyNote(reply);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('mywiki.askAI', (reply) => {
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "正在生成 AI 响应...",
            cancellable: true
        }, async () => {
            await askAI(reply);
        });
    }));
    context.subscriptions.push(vscode.commands.registerCommand('mywiki.aiEdit', (reply) => {
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "正在生成 AI 响应...",
            cancellable: true
        }, async () => {
            await aiEdit(reply);
        });
    }));
    context.subscriptions.push(vscode.commands.registerCommand('mywiki.genDocString', (reply) => {
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "正在生成 AI 响应...",
            cancellable: true
        }, async () => {
            reply.text = "用代码语言的语法为上述代码编写文档字符串。";
            await askAI(reply);
        });
    }));
    context.subscriptions.push(vscode.commands.registerCommand('mywiki.replyNote', (reply) => {
        replyNote(reply);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('mywiki.deleteNoteComment', (comment) => {
        const thread = comment.parent;
        if (!thread) {
            return;
        }
        thread.comments = thread.comments.filter(cmt => cmt.id !== comment.id);
        if (thread.comments.length === 0) {
            thread.dispose();
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('mywiki.deleteNote', (thread) => {
        thread.dispose();
    }));
    context.subscriptions.push(vscode.commands.registerCommand('mywiki.cancelsaveNote', (comment) => {
        if (!comment.parent) {
            return;
        }
        comment.parent.comments = comment.parent.comments.map(cmt => {
            if (cmt.id === comment.id) {
                cmt.body = cmt.savedBody;
                cmt.mode = vscode.CommentMode.Preview;
            }
            return cmt;
        });
    }));
    context.subscriptions.push(vscode.commands.registerCommand('mywiki.saveNote', (comment) => {
        if (!comment.parent) {
            return;
        }
        comment.parent.comments = comment.parent.comments.map(cmt => {
            if (cmt.id === comment.id) {
                cmt.savedBody = cmt.body;
                cmt.mode = vscode.CommentMode.Preview;
            }
            return cmt;
        });
    }));
    context.subscriptions.push(vscode.commands.registerCommand('mywiki.editNote', (comment) => {
        if (!comment.parent) {
            return;
        }
        comment.parent.comments = comment.parent.comments.map(cmt => {
            if (cmt.id === comment.id) {
                cmt.mode = vscode.CommentMode.Editing;
            }
            return cmt;
        });
    }));
    context.subscriptions.push(vscode.commands.registerCommand('mywiki.dispose', () => {
        commentController.dispose();
    }));
    /**
     * Generates the prompt to pass to OpenAI.
     * Prompt includes:
     * - Role play text that gives context to AI
     * - Code block highlighted for the comment thread
     * - All of past conversation history + example conversation
     * - User's new question
     * @param question
     * @param thread
     * @returns
     */
    async function generatePromptV1(question, thread) {
        //const rolePlay =
        //	"I want you to act as a highly intelligent AI chatbot that has deep understanding of any coding language and its API documentations. I will provide you with a code block and your role is to provide a comprehensive answer to any questions or requests that I will ask about the code block. Please answer in as much detail as possible and not be limited to brevity. It is very important that you provide verbose answers and answer in markdown format.";
        const rolePlay = "我现在将作为一个高度智能的AI聊天机器人,对任何编码语言及其API文档有深入的理解。我将提供一段代码,您的角色是对我提出的任何与代码块相关的问题或请求提供全面且详细的答案。请尽可能详细地回答,不要求简洁。提供详尽的答案并以Markdown格式回答非常重要。";
        const codeBlock = await getCommentThreadCode(thread);
        let conversation = "人类: 你是谁?\n\nAI: 我是AI机器人。\n\n";
        const filteredComments = thread.comments.filter(comment => comment.label !== "NOTE");
        for (let i = Math.max(0, filteredComments.length - 8); i < filteredComments.length; i++) {
            if (filteredComments[i].author.name === "VS Code") {
                conversation += `人类: ${filteredComments[i].body.value}\n\n`;
            }
            else if (filteredComments[i].author.name === "Scribe AI") {
                conversation += `AI: ${filteredComments[i].body.value}\n\n`;
            }
        }
        conversation += `人类: ${question}\n\nAI: `;
        return rolePlay + "\n```\n" + codeBlock + "\n```\n\n\n" + conversation;
    }
    /**
     * Generates the prompt to pass to OpenAI ChatGPT API.
     * Prompt includes:
     * - Role play text that gives context to AI
     * - Code block highlighted for the comment thread
     * - All of past conversation history + example conversation
     * - User's new question
     * @param question
     * @param thread
     * @returns
     */
    async function generatePromptChatGPT(question, thread) {
        const messages = [];
        //const rolePlay =
        //	"I want you to act as a highly intelligent AI chatbot that has deep understanding of any coding language and its API documentations. I will provide you with a code block and your role is to provide a comprehensive answer to any questions or requests that I will ask about the code block. Please answer in as much detail as possible and not be limited to brevity. It is very important that you provide verbose answers and answer in markdown format.";
        const rolePlay = "你将作为一个高度智能的AI聊天机器人,对任何编码语言及其API文档有深入的理解。我将提供一段代码,你的角色是对我提出的任何与代码块相关的问题或请求提供全面且详细的答案。请尽可能详细地回答,不要求简洁。提供详尽的答案并以Markdown格式回答非常重要。";
        const codeBlock = await getCommentThreadCode(thread);
        messages.push({ "role": "system", "content": rolePlay + "\nCode:\n```\n" + codeBlock + "\n```" });
        messages.push({ "role": "user", "content": "你是谁?" });
        messages.push({ "role": "assistant", "content": "我是AI机器人。" });
        const filteredComments = thread.comments.filter(comment => comment.label !== "NOTE");
        for (let i = Math.max(0, filteredComments.length - 8); i < filteredComments.length; i++) {
            if (filteredComments[i].author.name === "VS Code") {
                messages.push({ "role": "user", "content": `${filteredComments[i].body.value}` });
            }
            else if (filteredComments[i].author.name === "Scribe AI") {
                messages.push({ "role": "assistant", "content": `${filteredComments[i].body.value}` });
            }
        }
        messages.push({ "role": "user", "content": `${question}` });
        return messages;
    }
    /**
     * Generates the prompt to pass to OpenAI ChatGPT API.
     * Prompt includes:
     * - Role play text that gives context to AI
     * - Code block highlighted for the comment thread
     * - All of past conversation history + example conversation
     * - User's new question
     * @param question
     * @param thread
     * @param reply
     * @returns
     */
    async function generateCodeChatGPT(question, thread, reply) {
        const messages = [];
        const rolePlay = "你将作为一个高度智能的AI聊天机器人,对任何编码语言及其API文档有深入的理解。我将提供一段代码,你的角色是根据我的要求对代码进行改写。请只提供代码以及必要的注释，不要做其他任何解释说明。提供详尽的代码并以Markdown格式回答非常重要。";
        const codeBlock = await getCommentThreadCode(thread);
        messages.push({ "role": "system", "content": rolePlay + "\nCode:\n```\n" + codeBlock + "\n```" });
        messages.push({ "role": "user", "content": "你是谁?" });
        messages.push({ "role": "assistant", "content": "我是AI机器人。" });
        const filteredComments = thread.comments.filter(comment => comment.label !== "NOTE");
        for (let i = Math.max(0, filteredComments.length - 8); i < filteredComments.length; i++) {
            if (filteredComments[i].author.name === "VS Code") {
                messages.push({ "role": "user", "content": `${filteredComments[i].body.value}` });
            }
            else if (filteredComments[i].author.name === "Scribe AI") {
                messages.push({ "role": "assistant", "content": `${filteredComments[i].body.value}` });
            }
        }
        messages.push({ "role": "user", "content": `${question}` });
        return messages;
    }
    /**
     * Generates the prompt to pass to OpenAI.
     * Note: Not as performant as V1 but consumes less tokens per request.
     * Prompt includes:
     * - Role play text that gives context to AI
     * - Code block highlighted for the comment thread
     * - An example conversation to give the AI an example. "Human: Who are you?\nAI: I am a intelligent AI chatbot\n";
     * - User's new question
     * @param question
     * @param thread
     * @returns
     */
    function generatePromptV2(question, thread) {
        /*const rolePlay =
            "I want you to act as a highly intelligent AI chatbot that has deep understanding of any coding language and its API documentations. "
            + "I will provide you with a code block and your role is to provide a comprehensive answer to any questions or requests that I will ask about the code block. Please answer in as much detail as possible and not be limited to brevity. It is very important that you provide verbose answers. (When responding to the following prompt, please make sure to properly style your response using Github Flavored Markdown."
            + " Use markdown syntax for things like headings, lists, colored text, code blocks, highlights etc. Make sure not to mention markdown or stying in your actual response."
            + " Try to write code inside a single code block if possible)";*/
        const rolePlay = "我希望你作为一个高度智能的AI聊天机器人,对任何编码语言及其API文档有深入的理解。 "
            + "我将提供一段代码,你的角色是对我提出的任何与代码块相关的问题或请求提供全面且详细的答案。请尽可能详细地回答,不要求简洁。提供详尽的答案非常重要。(回应以下提示时,请确保使用Github Flavored Markdown properbly样式化您的回答。)"
            + " 使用markdown语法进行标题、列表、彩色文本、代码块、高亮等样式。确保在实际回复中不提到markdown或样式。 "
            + " 如果可能的话,尽量在单个代码块中编写代码。";
        const codeBlock = getCommentThreadCode(thread);
        let conversation = "人类: 你是谁?\n\nAI: 我是AI机器人\n\n";
        conversation += `人类: ${question}\n\nAI: `;
        return rolePlay + "\n" + codeBlock + "\n\n\n" + conversation;
    }
    /**
     * Gets the highlighted code for this comment thread
     * @param thread
     * @returns
     */
    async function getCommentThreadCode(thread) {
        const document = await vscode.workspace.openTextDocument(thread.uri);
        // Get selected code for the comment thread
        return document.getText(thread.range).trim();
    }
    /**
     * User replies with a question.
     * The question + conversation history + code block then gets used
     * as input to call the OpenAI API to get a response.
     * The new humna question and AI response then gets added to the thread.
     * @param reply
     */
    async function askAI(reply) {
        const question = reply.text.trim();
        const thread = reply.thread;
        const model = vscode.workspace.getConfiguration('scribeai').get('models') + "";
        let prompt = "";
        let chatGPTPrompt = [];
        if (model === "ChatGPT" || model === "gpt-4") {
            chatGPTPrompt = await generatePromptChatGPT(question, thread);
        }
        else {
            prompt = await generatePromptV1(question, thread);
        }
        const humanComment = new NoteComment(new vscode.MarkdownString(question), vscode.CommentMode.Preview, { name: 'VS Code', iconPath: vscode.Uri.parse("https://img.icons8.com/fluency/96/null/user-male-circle.png") }, thread, thread.comments.length ? 'canDelete' : undefined);
        thread.comments = [...thread.comments, humanComment];
        // If openai is not initialized initialize it with existing API Key 
        // or if doesn't exist then ask user to input API Key.
        if (openai === undefined) {
            if (vscode.workspace.getConfiguration('scribeai').get('ApiKey') === '') {
                const apiKey = await showInputBox();
            }
            openai = new openai_1.OpenAIApi(new openai_1.Configuration({
                apiKey: vscode.workspace.getConfiguration('scribeai').get('ApiKey'),
                basePath: vscode.workspace.getConfiguration('scribeai').get('ApiBaseUrl'),
            }));
        }
        if (model === "ChatGPT" || model === "gpt-4") {
            const response = await openai.createChatCompletion({
                model: (model === "ChatGPT" ? "gpt-3.5-turbo" : "gpt-4"),
                messages: chatGPTPrompt,
                temperature: 0,
                max_tokens: 1000,
                top_p: 1.0,
                frequency_penalty: 1,
                presence_penalty: 1,
            });
            const responseText = response.data.choices[0].message?.content ? response.data.choices[0].message?.content : '发生错误. 请重试...';
            const AIComment = new NoteComment(new vscode.MarkdownString(responseText.trim()), vscode.CommentMode.Preview, { name: 'Scribe AI', iconPath: vscode.Uri.parse("https://img.icons8.com/fluency/96/null/chatbot.png") }, thread, thread.comments.length ? 'canDelete' : undefined);
            thread.comments = [...thread.comments, AIComment];
        }
        else {
            const response = await openai.createCompletion({
                model: model,
                prompt: prompt,
                //prompt: generatePromptV2(question, thread),
                temperature: 0,
                max_tokens: 500,
                top_p: 1.0,
                frequency_penalty: 1,
                presence_penalty: 1,
                stop: ["人类:"], // V1: "Human:"
            });
            const responseText = response.data.choices[0].text ? response.data.choices[0].text : '发生错误. 请重试...';
            const AIComment = new NoteComment(new vscode.MarkdownString(responseText.trim()), vscode.CommentMode.Preview, { name: 'Scribe AI', iconPath: vscode.Uri.parse("https://img.icons8.com/fluency/96/null/chatbot.png") }, thread, thread.comments.length ? 'canDelete' : undefined);
            thread.comments = [...thread.comments, AIComment];
        }
    }
    /**
     * AI will edit the highlighted code based on the given instructions.
     * Uses the OpenAI Edits endpoint. Replaces the highlighted code
     * with AI generated code. You can undo to go back.
     *
     * @param reply
     * @returns
     */
    async function aiEdit(reply) {
        const question = reply.text.trim();
        const thread = reply.thread;
        const model = vscode.workspace.getConfiguration('scribeai').get('models') + "";
        let chatGPTPrompt = [];
        let prompt = "";
        if (model === "ChatGPT" || model === "gpt-4") {
            chatGPTPrompt = await generateCodeChatGPT(question, thread, reply);
        }
        else {
            prompt = await generatePromptV1(question, thread);
        }
        // If openai is not initialized initialize it with existing API Key 
        // or if doesn't exist then ask user to input API Key.
        if (openai === undefined) {
            if (vscode.workspace.getConfiguration('scribeai').get('ApiKey') === '') {
                const apiKey = await showInputBox();
            }
            openai = new openai_1.OpenAIApi(new openai_1.Configuration({
                apiKey: vscode.workspace.getConfiguration('scribeai').get('ApiKey'),
                basePath: vscode.workspace.getConfiguration('scribeai').get('ApiBaseUrl'),
            }));
        }
        const response = await openai.createChatCompletion({
            model: (model === "ChatGPT" ? "gpt-3.5-turbo" : "gpt-4"),
            messages: chatGPTPrompt,
            temperature: 0,
            max_tokens: 1000,
            top_p: 1.0,
            frequency_penalty: 1,
            presence_penalty: 1,
        });
        const responseText = response.data.choices[0].message?.content ? response.data.choices[0].message?.content : '发生错误. 请重试...';
        if (responseText != '发生错误. 请重试...') {
            const editor = await vscode.window.showTextDocument(thread.uri);
            if (!editor) {
                return; // No open text editor
            }
            editor.edit(editBuilder => {
                editBuilder.replace(thread.range, responseText + "");
            });
        }
        else {
            vscode.window.showErrorMessage(responseText);
        }
    }
    /**
     * Adds a regular note. Doesn't call OpenAI API.
     * @param reply
     */
    function replyNote(reply) {
        const thread = reply.thread;
        const newComment = new NoteComment(new vscode.MarkdownString(reply.text), vscode.CommentMode.Preview, { name: 'VS Code', iconPath: vscode.Uri.parse("https://img.icons8.com/fluency/96/null/user-male-circle.png") }, thread, thread.comments.length ? 'canDelete' : undefined);
        newComment.label = 'NOTE';
        thread.comments = [...thread.comments, newComment];
    }
}
exports.activate = activate;
//# sourceMappingURL=extension.js.map