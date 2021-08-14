import { Poll, Vote } from "@prisma/client";
import { EmbedField, GuildEmoji, Message, MessageActionRow, MessageEmbed, MessageSelectMenu } from "discord.js";
import EmojiReg from "emoji-regex";
import progressBar from "string-progressbar";
import { channelIDs, emojiIDs } from "../../../configuration/config";
import { prisma, queries } from "../../../helpers/prisma-init";
import { SlashCommand } from "../../../structures/EntrypointSlashCommand";

const options = <const>[1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const command = new SlashCommand(<const>{
    description: "Creates a message that users can react to to receive a role",
    options: [
        {
            name: "title",
            description: "The title for the poll",
            required: true,
            type: "STRING"
        },

        ...options.map(
            (num) =>
                <const>{
                    name: `option${num}`,
                    description: `Option #${num}`,
                    required: num <= 2,
                    type: "STRING"
                }
        ),
        {
            name: "min_choices",
            description: "The min number of choices a user must choose",
            required: false,
            type: "INTEGER"
        },
        {
            name: "max_choices",
            description: "The max number of choices a user must choose",
            required: false,
            type: "INTEGER"
        }
    ]
});

type ParsedOption = { text: string; emoji?: string };
command.setHandler(async (ctx) => {
    await ctx.deferReply();

    const shouldCreateThread = ctx.channel.id === channelIDs.polls;

    const { title, option1, option2, min_choices, max_choices, ...optDict } = ctx.opts;

    if (!option1 || !option2) throw new Error("First two options should be required");

    const options: string[] = [option1, option2, ...Object.values(optDict).filter((a) => a)].map((o) => o.trim());

    const discordEmojiRegex = /<a{0,1}:(?<name>.*?):(?<id>\d+)>/;

    const parsedOptions: ParsedOption[] = [];

    for (const option of options) {
        const discordMatch = option.match(discordEmojiRegex);

        // Has valid Discord emoji
        if (discordMatch?.index === 0) {
            const emoji = discordMatch[0];
            parsedOptions.push({ text: option.replace(emoji, "").trim(), emoji });
        }
        // Doesn't have a Discord emoji, might have a unicode emoji
        else {
            const emojiReg = EmojiReg();
            const possibleEmoji = option.split(" ")[0].trim();
            const [emoji] = possibleEmoji.match(emojiReg) || [];

            const text = emoji ? option.replace(emoji, "").trim() : option;
            parsedOptions.push({ text, emoji });
        }
    }

    // Create user if not exists
    await queries.findOrCreateUser(ctx.user.id);

    const poll = await prisma.poll.create({
        data: { userId: ctx.user.id, name: title, options: parsedOptions.map((p) => p.text) },
        include: { votes: true }
    });

    const embed = new MessageEmbed().setAuthor(title, ctx.user.displayAvatarURL());

    embed.fields = generateStatsDescription(poll, parsedOptions);

    const selectMenu = new MessageSelectMenu()
        .setCustomId(genPollResId({ pollId: poll.id.toString() }))
        .setMinValues((min_choices as number) || 1)
        .setMaxValues((max_choices as number) || 1)
        .setPlaceholder("Select a poll choice");

    for (let i = 0; i < parsedOptions.length; i++) {
        const option = parsedOptions[i];
        const emoji = option.emoji;
        selectMenu.addOptions({ label: option.text.substring(0, 25), emoji, value: `${i}` });
    }

    const actionRow = new MessageActionRow().addComponents(selectMenu);

    await ctx.send({ embeds: [embed], components: [actionRow] });
    if (shouldCreateThread) {
        const m = (await ctx.fetchReply()) as Message;
        const thread = await ctx.channel.threads.create({
            name: title,
            autoArchiveDuration: 1440,
            reason: "Auto poll thread",
            startMessage: m
        });
        await thread.send({
            embeds: [
                new MessageEmbed({
                    description:
                        "Welcome to the discussion for the poll! Unfortunately, Discord's thread notifications is currently a little weird, so here are some tips:\n\n`1.` When you send a message here, Discord signs you up for all notifications. You can change this by hitting the bell icon and changing to `Only mentions` or `Nothing`.\n\n`2.` If you want to remove the thread from your channel list, right click the thread channel and hit `Leave thread`.\n\nWe expect Discord to fix these issues soon, so if any other issues arise please let the staff know!"
                })
            ]
        });
    }
});

const genPollResId = command.addInteractionListener("pollresponse", <const>["pollId"], async (ctx, args) => {
    if (!ctx.isSelectMenu()) return;
    const { pollId } = args;
    const indices = ctx.values?.map((n) => parseInt(n)).filter((n) => n >= 0 && !isNaN(n));
    const guild = ctx.guild;
    if (indices.length < 1 || !guild) return;

    const msg = ctx.message as Message;

    const poll = await prisma.poll.findUnique({ where: { id: +pollId }, include: { votes: true } });
    if (!poll) return;

    // Ensure user hasn't voted
    const previousVote = poll.votes.find((vote) => vote.userId === ctx.user.id);

    const castVote = await prisma.vote.upsert({
        where: { id: previousVote?.id || -1 },
        update: { choices: indices },
        create: { choices: indices, userId: ctx.user.id, pollId: poll.id }
    });

    // Update poll object
    if (previousVote) previousVote.choices = castVote.choices;
    else poll.votes.push(castVote);

    const parsedOptions: ParsedOption[] = [];
    for (const actionRow of msg.components) {
        const selectMenu = actionRow.components[0];
        if (selectMenu.type !== "SELECT_MENU") return;

        for (const option of selectMenu.options) {
            const emoji = option.emoji as GuildEmoji;
            const emojiString = emoji?.id ? (await guild.emojis.fetch(emoji.id.toSnowflake())).toString() : emoji?.name;
            parsedOptions.push({ text: option.label as string, emoji: emojiString as string | undefined });
        }
    }

    const embed = ctx.message.embeds[0];
    embed.fields = generateStatsDescription(poll, parsedOptions);

    await msg.edit({ embeds: [embed] });
});

type PollWithVotes = Poll & { votes: Vote[] };
function generateStatsDescription(poll: PollWithVotes, parsedOptions: ParsedOption[]): EmbedField[] {
    // Calculate votes for each option
    const votes = parsedOptions.map(() => 0);
    const totalVotes = poll.votes.length;

    for (const vote of poll.votes) {
        for (const choice of vote.choices) {
            votes[choice]++;
        }
    }

    const optionsWithVotes = parsedOptions
        .map((opt, idx) => ({ opt, count: votes[idx] }))
        .sort((opt1, opt2) => opt2.count - opt1.count);

    const tempEmbed = new MessageEmbed();

    const toEmoji = (id: string) => `<:name:${id}>`;
    const startEmoji = toEmoji(emojiIDs.poll.start);
    const filledEmoji = toEmoji(emojiIDs.poll.filled);
    const emptyEmoji = toEmoji(emojiIDs.poll.empty);
    const endEmoji = toEmoji(emojiIDs.poll.end);

    optionsWithVotes.forEach(({ opt, count }) => {
        const [progress] = progressBar.filledBar(totalVotes === 0 ? 1 : totalVotes, count, 8, emptyEmoji, filledEmoji);
        const emoji = opt.emoji ? `${opt.emoji} ` : "";
        const basePercent = (100 * count) / totalVotes;
        const percent = (isFinite(basePercent) ? basePercent : 0).toPrecision(3);

        tempEmbed.addField(`${emoji}${opt.text}`.trim(), `${startEmoji}${progress}${endEmoji} ${count} (${percent}%)`);
    });

    return tempEmbed.fields;
}

export default command;