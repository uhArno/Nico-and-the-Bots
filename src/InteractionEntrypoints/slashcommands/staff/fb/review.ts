import { MessageEmbed } from "discord.js";
import { roles } from "../../../../Configuration/config";
import F from "../../../../Helpers/funcs";
import { prisma } from "../../../../Helpers/prisma-init";
import { SlashCommand } from "../../../../Structures/EntrypointSlashCommand";

const command = new SlashCommand(<const>{
    description: "Shows the oldest FB apps that have yet to be reviewe",
    options: []
});

command.setHandler(async (ctx) => {
    await ctx.deferReply();

    const awaiting = await prisma.firebreatherApplication.findMany({
        where: { submittedAt: { not: null }, decidedAt: null },
        orderBy: { submittedAt: "asc" }
    });

    const fbRole = await ctx.guild.roles.fetch(roles.deatheaters);

    const embed = new MessageEmbed().setAuthor("Firebreather Application Review Queue", fbRole?.iconURL() || undefined);

    for (const app of awaiting) {
        const timestamp = F.discordTimestamp(app.submittedAt || new Date(), "relative");
        const member = await ctx.guild.members.fetch(app.userId).catch((e) => undefined);
        if (!member) continue;
        embed.addField(`${member.displayName}`, `Submitted ${timestamp} | [View](${app.messageUrl})`);
    }

    await ctx.editReply({ embeds: [embed] });
});

export default command;