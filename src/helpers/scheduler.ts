/**
 * Manages things that are scheduled in the database (reminders, mutes, etc.)
 */

import { secondsToMilliseconds } from "date-fns";
import { Client, Guild, GuildMember, MessageEmbed, MessageOptions, Snowflake } from "discord.js";
import { Connection } from "typeorm";
import { guildID, roles } from "../configuration/config";
import { Item } from "../database/entities/Item";
import { Reminder } from "../database/entities/Reminder";
import F from "./funcs";
import { prisma } from "./prisma-init";

const CHECK_INTERVAL = secondsToMilliseconds(10);

export default async function (client: Client, connection: Connection): Promise<void> {
    const guild = await client.guilds.fetch(guildID);

    async function runChecks() {
        await checkMutes(guild, connection);
        await checkReminders(guild);
        await F.wait(CHECK_INTERVAL);
        runChecks();
    }
    runChecks();
}

async function tryToDM(member: GuildMember, msg: MessageOptions): Promise<void> {
    try {
        const dm = await member.createDM();
        await dm.send(msg);
    } catch (e) {
        console.log(e, /UNABLE_TO_DM/);
    }
}

async function checkMutes(guild: Guild, connection: Connection): Promise<void> {
    const finishedMutes = await connection
        .getMongoRepository(Item)
        .find({ where: { type: "Timeout", time: { $lt: Date.now() } } });

    const successfulUnmutes: Item[] = [];
    for (const mute of finishedMutes) {
        try {
            const member = await guild.members.fetch(mute.identifier as Snowflake);

            // Remove timeout, give back Banditos role
            await member.roles.remove(roles.muted);
            await member.roles.add(roles.banditos);

            const embed = new MessageEmbed({ description: "Your mute has ended." });
            tryToDM(member, { embeds: [embed] });

            successfulUnmutes.push(mute);
        } catch (e) {
            console.log(e, /UNABLE_TO_UNMUTE/);
        }
    }

    await connection.manager.remove(successfulUnmutes);
}

async function checkReminders(guild: Guild): Promise<void> {
    const finishedReminders = await prisma.reminder.findMany({ where: { sendAt: { lte: new Date() } } });

    for (const rem of finishedReminders) {
        try {
            const member = await guild.members.fetch(rem.userId as Snowflake);

            const dm = await member.createDM();
            const embed = new MessageEmbed()
                .setTitle("Your Reminder")
                .setDescription(rem.text)
                .setTimestamp(rem.createdAt);

            await dm.send({ embeds: [embed] });
        } catch (e) {
            console.log(e, /UNABLE_TO_SEND_REMINDER/);
        }
    }

    // Remove them all, regardless of whether they were sent
    const fetchedIds = finishedReminders.map((r) => r.id);
    await prisma.reminder.deleteMany({ where: { id: { in: fetchedIds } } });
}
