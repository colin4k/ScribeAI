'use strict';

import * as vscode from 'vscode';
import { ChatCompletionRequestMessage, Configuration, OpenAIApi } from "openai";

let openai: OpenAIApi | undefined = undefined;

let commentId = 1;

const base_url = 'https://xxx.xxx.xxx/v1';

class NoteComment implements vscode.Comment {
	id: number;
	label: string | undefined;
	savedBody: string | vscode.MarkdownString; // for the Cancel button
	constructor(
		public body: string | vscode.MarkdownString,
		public mode: vscode.CommentMode,
		public author: vscode.CommentAuthorInformation,
		public parent?: vscode.CommentThread,
		public contextValue?: string
	) {
		this.id = ++commentId;
		this.savedBody = this.body;
	}
}

/**
 * Shows an input box for getting API key using window.showInputBox().
 * Checks if inputted API Key is valid.
 * Updates the User Settings API Key with the newly inputted API Key.
 */
export async function showInputBox() {
	const result = await vscode.window.showInputBox({
		ignoreFocusOut: true,
		placeHolder: '您的 OpenAI API Key',
		title: 'Scribe AI',
		prompt: '您尚未设置OpenAI API密钥,或者您的API密钥不正确,请输入API密钥以使用ScribeAI扩展。',
		validateInput: async text => {
			vscode.window.showInformationMessage(`Validating: ${text}`);
			if (text === '') {
				return 'API Key 不能为空';
			}
			try {
				openai = new OpenAIApi(new Configuration({
					apiKey: text,
					basePath: base_url,
				}));
				await openai.listModels();
			} catch(err) {
				return 'API key 不正确';
			}
			return null;
		}
	});
	vscode.window.showInformationMessage(`Got: ${result}`);
	// Write to user settings
	await vscode.workspace.getConfiguration('scribeai').update('ApiKey', result, true);
	// Write to workspace settings
	//await vscode.workspace.getConfiguration('scribeai').update('ApiKey', result, false);
	return result;
}

async function validateAPIKey() {
	try {
		openai = new OpenAIApi(new Configuration({
			apiKey: vscode.workspace.getConfiguration('scribeai').get('ApiKey'),
			basePath: base_url,
		}));
		await openai.listModels();
	} catch(err) {
		return false;
	}
	return true;
}

export async function activate(context: vscode.ExtensionContext) {
	// Workspace settings override User settings when getting the setting.
	if (vscode.workspace.getConfiguration('scribeai').get('ApiKey') === "" 
		|| !(await validateAPIKey())) {
		const apiKey = await showInputBox();
	}
	if (openai === undefined) {
		openai = new OpenAIApi(new Configuration({
			apiKey: vscode.workspace.getConfiguration('scribeai').get('ApiKey'),
			basePath: base_url,
		}));
	}

	// A `CommentController` is able to provide comments for documents.
	const commentController = vscode.comments.createCommentController('comment-scribeai', 'ScribeAI Comment Controller');
	context.subscriptions.push(commentController);

	// A `CommentingRangeProvider` controls where gutter decorations that allow adding comments are shown
	commentController.commentingRangeProvider = {
		provideCommentingRanges: (document: vscode.TextDocument, token: vscode.CancellationToken) => {
			const lineCount = document.lineCount;
			return [new vscode.Range(0, 0, lineCount - 1, 0)];
		}
	};

	commentController.options = {
		prompt: "询问 Scribe AI...",
		placeHolder: "可以问我任何问题! 例如: \"用简单的英语简明扼要的中文解释上述代码\""
	};

	context.subscriptions.push(vscode.commands.registerCommand('mywiki.createNote', (reply: vscode.CommentReply) => {
		replyNote(reply);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('mywiki.askAI', (reply: vscode.CommentReply) => {
		vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: "正在生成 AI 响应...",
			cancellable: true
		}, async () => {
			await askAI(reply);		
		});
	}));

	context.subscriptions.push(vscode.commands.registerCommand('mywiki.aiEdit', (reply: vscode.CommentReply) => {
		vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: "正在生成 AI 响应...",
			cancellable: true
		}, async () => {
			await aiEdit(reply);		
		});
	}));

	context.subscriptions.push(vscode.commands.registerCommand('mywiki.genDocString', (reply: vscode.CommentReply) => {
		vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: "正在生成 AI 响应...",
			cancellable: true
		}, async () => {
			reply.text = "用代码语言的语法为上述代码编写文档字符串。";
			await askAI(reply);		
		});
	}));

	context.subscriptions.push(vscode.commands.registerCommand('mywiki.replyNote', (reply: vscode.CommentReply) => {
		replyNote(reply);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('mywiki.deleteNoteComment', (comment: NoteComment) => {
		const thread = comment.parent;
		if (!thread) {
			return;
		}

		thread.comments = thread.comments.filter(cmt => (cmt as NoteComment).id !== comment.id);

		if (thread.comments.length === 0) {
			thread.dispose();
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('mywiki.deleteNote', (thread: vscode.CommentThread) => {
		thread.dispose();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('mywiki.cancelsaveNote', (comment: NoteComment) => {
		if (!comment.parent) {
			return;
		}

		comment.parent.comments = comment.parent.comments.map(cmt => {
			if ((cmt as NoteComment).id === comment.id) {
				cmt.body = (cmt as NoteComment).savedBody;
				cmt.mode = vscode.CommentMode.Preview;
			}

			return cmt;
		});
	}));

	context.subscriptions.push(vscode.commands.registerCommand('mywiki.saveNote', (comment: NoteComment) => {
		if (!comment.parent) {
			return;
		}

		comment.parent.comments = comment.parent.comments.map(cmt => {
			if ((cmt as NoteComment).id === comment.id) {
				(cmt as NoteComment).savedBody = cmt.body;
				cmt.mode = vscode.CommentMode.Preview;
			}

			return cmt;
		});
	}));

	context.subscriptions.push(vscode.commands.registerCommand('mywiki.editNote', (comment: NoteComment) => {
		if (!comment.parent) {
			return;
		}

		comment.parent.comments = comment.parent.comments.map(cmt => {
			if ((cmt as NoteComment).id === comment.id) {
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
	async function generatePromptV1(question: string, thread: vscode.CommentThread) {
		//const rolePlay =
		//	"I want you to act as a highly intelligent AI chatbot that has deep understanding of any coding language and its API documentations. I will provide you with a code block and your role is to provide a comprehensive answer to any questions or requests that I will ask about the code block. Please answer in as much detail as possible and not be limited to brevity. It is very important that you provide verbose answers and answer in markdown format.";
		const rolePlay = 
			"我现在将作为一个高度智能的AI聊天机器人,对任何编码语言及其API文档有深入的理解。我将提供一段代码,您的角色是对我提出的任何与代码块相关的问题或请求提供全面且详细的答案。请尽可能详细地回答,不要求简洁。提供详尽的答案并以Markdown格式回答非常重要。";
			
		const codeBlock = await getCommentThreadCode(thread);
		
		let conversation = "人类: 你是谁?\n\nAI: 我是AI机器人。\n\n";
		
		const filteredComments = thread.comments.filter(comment => comment.label !== "NOTE");

		for (let i = Math.max(0, filteredComments.length - 8); i < filteredComments.length; i++) {
				if (filteredComments[i].author.name === "VS Code") {
					conversation += `人类: ${(filteredComments[i].body as vscode.MarkdownString).value}\n\n`;
				} else if (filteredComments[i].author.name === "Scribe AI") {
					conversation += `AI: ${(filteredComments[i].body as vscode.MarkdownString).value}\n\n`;
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
	async function generatePromptChatGPT(question: string, thread: vscode.CommentThread) {
		const messages: ChatCompletionRequestMessage[] = [];
		//const rolePlay =
		//	"I want you to act as a highly intelligent AI chatbot that has deep understanding of any coding language and its API documentations. I will provide you with a code block and your role is to provide a comprehensive answer to any questions or requests that I will ask about the code block. Please answer in as much detail as possible and not be limited to brevity. It is very important that you provide verbose answers and answer in markdown format.";
		const rolePlay = 
			"我现在将作为一个高度智能的AI聊天机器人,对任何编码语言及其API文档有深入的理解。我将提供一段代码,您的角色是对我提出的任何与代码块相关的问题或请求提供全面且详细的答案。请尽可能详细地回答,不要求简洁。提供详尽的答案并以Markdown格式回答非常重要。";
		
		const codeBlock = await getCommentThreadCode(thread);
		
		messages.push({"role" : "system", "content" : rolePlay + "\nCode:\n```\n" + codeBlock + "\n```"});
		messages.push({"role" : "user", "content" : "你是谁?"});
		messages.push({"role" : "assistant", "content" : "我是AI机器人。"});

		const filteredComments = thread.comments.filter(comment => comment.label !== "NOTE");

		for (let i = Math.max(0, filteredComments.length - 8); i < filteredComments.length; i++) {
				if (filteredComments[i].author.name === "VS Code") {
					messages.push({"role" : "user", "content" : `${(filteredComments[i].body as vscode.MarkdownString).value}`});
				} else if (filteredComments[i].author.name === "Scribe AI") {
					messages.push({"role" : "assistant", "content" : `${(filteredComments[i].body as vscode.MarkdownString).value}`});
				}
		}
		messages.push({"role" : "user", "content" : `${question}`});


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
	function generatePromptV2(question: string, thread: vscode.CommentThread) {
		/*const rolePlay =
			"I want you to act as a highly intelligent AI chatbot that has deep understanding of any coding language and its API documentations. "
			+ "I will provide you with a code block and your role is to provide a comprehensive answer to any questions or requests that I will ask about the code block. Please answer in as much detail as possible and not be limited to brevity. It is very important that you provide verbose answers. (When responding to the following prompt, please make sure to properly style your response using Github Flavored Markdown."
			+ " Use markdown syntax for things like headings, lists, colored text, code blocks, highlights etc. Make sure not to mention markdown or stying in your actual response."
			+ " Try to write code inside a single code block if possible)";*/
		const rolePlay = 
			"我希望你作为一个高度智能的AI聊天机器人,对任何编码语言及其API文档有深入的理解。 "
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
	async function getCommentThreadCode(thread: vscode.CommentThread) {
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
	async function askAI(reply: vscode.CommentReply) {
		const question = reply.text.trim();
		const thread = reply.thread;
		const model = vscode.workspace.getConfiguration('scribeai').get('models') + "";
		let prompt = "";
		let chatGPTPrompt: ChatCompletionRequestMessage[] = [];
		if (model === "ChatGPT" || model === "gpt-4") {
			chatGPTPrompt = await generatePromptChatGPT(question, thread);
		} else {
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
		
			openai = new OpenAIApi(new Configuration({
				apiKey: vscode.workspace.getConfiguration('scribeai').get('ApiKey'),
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
		} else {
			const response = await openai.createCompletion({
				model: model,
				prompt: prompt,
				//prompt: generatePromptV2(question, thread),
				temperature: 0,
				max_tokens: 500,
				top_p: 1.0,
				frequency_penalty: 1,
				presence_penalty: 1,
				stop: ["人类:"],  // V1: "Human:"
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
	async function aiEdit(reply: vscode.CommentReply) {
		const question = reply.text.trim();
		const code = await getCommentThreadCode(reply.thread);
		const thread = reply.thread;

		// If openai is not initialized initialize it with existing API Key 
		// or if doesn't exist then ask user to input API Key.
		if (openai === undefined) {
			if (vscode.workspace.getConfiguration('scribeai').get('ApiKey') === '') {
				const apiKey = await showInputBox();
			}
		
			openai = new OpenAIApi(new Configuration({
				apiKey: vscode.workspace.getConfiguration('scribeai').get('ApiKey'),
			}));
		}

		const response = await openai.createEdit({
			//model: "code-davinci-edit-001",
			model: "code-davinci-002",
			input: code,
			instruction: question,
			temperature: 0,
			top_p: 1.0,
		});
		if (response.data.choices[0].text) {
			const editor = await vscode.window.showTextDocument(thread.uri);
			if (!editor) {
				return; // No open text editor
			}
			editor.edit(editBuilder => {
				editBuilder.replace(thread.range, response.data.choices[0].text + "");
			});
		} else {
			vscode.window.showErrorMessage('发生错误. 请重试...');
		}
	}

	/**
	 * Adds a regular note. Doesn't call OpenAI API.
	 * @param reply 
	 */
	function replyNote(reply: vscode.CommentReply) {
		const thread = reply.thread;
		const newComment = new NoteComment(new vscode.MarkdownString(reply.text), vscode.CommentMode.Preview, { name: 'VS Code', iconPath: vscode.Uri.parse("https://img.icons8.com/fluency/96/null/user-male-circle.png") }, thread, thread.comments.length ? 'canDelete' : undefined);
		newComment.label = 'NOTE';
		thread.comments = [...thread.comments, newComment];
	}
}
