import { Command } from '../structures/Command';
import CommandHandler from '../handlers/CommandHandler';
import * as Lexure from 'lexure';
import { Message, NewsChannel, TextChannel, FileOptions, MessageOptions, MessageEditOptions } from 'discord.js';
import { Embed } from '../util/Embed';
import { MESSAGES, SNOWFLAKE_PATTERN } from '../util/constants';
import { KEYS } from '../util/keys';

const { COMMANDS: { COMMON, RESOURCE } } = MESSAGES;

export default class extends Command {
	public constructor(handler: CommandHandler) {
		super('resource', handler, {
			aliases: ['res', 'resources'],
			description: {
				content: 'Initiate or edit a shared resource anyone with permission to manage messages in the resources channel can edit. To post as embed use the `--embed` flag. Attached files will be sent as attachments.',
				usage: 'resource <add <channel> <content>|edit <message> <content>>',
				flags: {
					'`--embed`, `-e`': 'embed the resource message'
				}
			},
			guildOnly: true,
			clientPermissions: ['VIEW_CHANNEL', 'SEND_MESSAGES', 'EMBED_LINKS', 'READ_MESSAGE_HISTORY'],
			userPermissions: ['VIEW_CHANNEL', 'MANAGE_MESSAGES']
		});
	}

	private readonly addAliases = ['add', '+', 'post'];
	private readonly editAliases = ['edit', 'e', 'update'];
	private readonly subCommands = this.addAliases.concat(this.editAliases);

	public async execute(message: Message, args: Lexure.Args): Promise<Message|void> {
		const { client } = this.handler;
		const { guild, author } = message;
		if (!guild) return;
		const subCommand = args.single();

		const useEmbed = args.flag('embed', 'e');

		if (!subCommand || !this.subCommands.includes(subCommand)) {
			return message.channel.send(COMMON.FAIL.NO_SUB_COMMAND(['add', 'edit']));
		}
		if (this.addAliases.includes(subCommand)) {
			const channelArgs = args.single();
			if (!channelArgs) {
				return message.channel.send(COMMON.FAIL.MISSING_ARGUMENT('channel'));
			}
			const channel = client.resolveChannel(guild, ['text', 'news'], channelArgs) as TextChannel | NewsChannel | undefined;
			if (!channel) {
				return message.channel.send(COMMON.FAIL.RESOLVE(channelArgs, 'channel'));
			}
			if (!channel.permissionsFor(author)?.has(this.userPermissions)) {
				return message.channel.send(RESOURCE.FAIL.MISSING_PERMISSIONS_USER);
			}
			const content = Lexure.joinTokens(args.many(), null, true);
			if (!content) {
				return message.channel.send(RESOURCE.FAIL.MISSING_CONTENT);
			}
			if (!channel.permissionsFor(client.user!)?.has(this.clientPermissions)) {
				return message.channel.send(RESOURCE.FAIL.MISSING_PERMISSIONS_BOT);
			}

			const data: MessageOptions = {};
			if (useEmbed) {
				data.embed = new Embed().setDescription(content).shorten();
			} else {
				data.content = content;
			}

			const files: FileOptions[] = [];
			for (const attachment of message.attachments.values()) {
				files.push({
					attachment: attachment.url,
					name: attachment.name
				});
			}
			data.files = files;

			const msg = await channel.send(data);
			const key = KEYS.RESOURCE(msg.id);
			await client.red.set(key, msg.channel.id);
			client.red.sadd(KEYS.RESOURCES_PER_CHANNEL(msg.channel.id), key);
			const prefix = await this.handler.prefix();
			return message.channel.send(RESOURCE.SUCCESS.SENT(prefix, msg.id));
		}
		const messageArgs = args.single();
		if (!messageArgs) {
			return message.channel.send(COMMON.FAIL.MISSING_ARGUMENT('message'));
		}
		const content = args.many().map(a => `${a.raw}${a.trailing}`).join(' ');
		if (!content) {
			return message.channel.send(RESOURCE.FAIL.MISSING_CONTENT);
		}

		const channelID = await client.red.get(KEYS.RESOURCE(messageArgs));
		if (!channelID) {
			return message.channel.send(RESOURCE.FAIL.NOT_FOUND);
		}

		const targetChannel = await client.resolveChannel(guild, ['text', 'news'], channelID) as TextChannel | NewsChannel | undefined;
		if (!targetChannel) {
			if (new RegExp(SNOWFLAKE_PATTERN).exec(channelID)) {
				const setKey = KEYS.RESOURCES_PER_CHANNEL(channelID);
				const keys = await client.red.smembers(setKey);
				client._pruneKeys([...keys, setKey]);
			}
			return message.channel.send(RESOURCE.FAIL.NOT_FOUND);
		}
		if (!targetChannel.permissionsFor(author)?.has(this.userPermissions)) {
			return message.channel.send(RESOURCE.FAIL.MISSING_PERMISSIONS_USER);
		}
		try {
			const msg = await targetChannel.messages.fetch(messageArgs);
			const data: MessageEditOptions = {};
			if (useEmbed) {
				data.embed = new Embed().setDescription(content).shorten();
				data.content = '';
			} else {
				data.content = content;
				data.embed = null;
			}
			await msg.edit(data);
			return message.channel.send(RESOURCE.SUCCESS.EDITED);
		} catch {
			if (new RegExp(SNOWFLAKE_PATTERN).exec(messageArgs)) {
				const key = KEYS.RESOURCE(messageArgs);
				client.red.del(key);
				client.red.srem(KEYS.RESOURCES_PER_CHANNEL(targetChannel.id), key);
			}
			return message.channel.send(RESOURCE.FAIL.NOT_FOUND);
		}
	}
}
