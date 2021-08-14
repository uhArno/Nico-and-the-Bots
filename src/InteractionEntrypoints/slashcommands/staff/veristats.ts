import { VerifiedQuizAnswer } from "@prisma/client";
import { MessageEmbed } from "discord.js";
import R from "ramda";
import progressBar from "string-progressbar";
import F from "../../../helpers/funcs";
import { prisma } from "../../../helpers/prisma-init";
import { SlashCommand } from "../../../structures/EntrypointSlashCommand";
import QuizQuestions from "../../../helpers/verified-quiz/quiz";

const command = new SlashCommand(<const>{
    description: "Shows stats about verified questions",
    options: [
        {
            name: "stat",
            description: "The stat to display",
            required: true,
            type: "STRING",
            choices: [
                { name: "Hardest Questions", value: "hardest" },
                { name: "Easiest Questions", value: "easiest" }
            ]
        }
    ]
});

command.setHandler(async (ctx) => {
    await ctx.deferReply();
    const allAnswers = await prisma.verifiedQuizAnswer.findMany();
    const results = QuizQuestions.map((q) => ({
        question: q,
        answers: allAnswers.filter((a) => a.questionId === q.id)
    })).filter((q) => q.answers.length > 0);

    const partitionByCorrectness = R.partition((a: VerifiedQuizAnswer): boolean => a.answer === 0);

    const fullStats = results.map((result) => {
        const { answers, question } = result;
        const [correct, incorrect] = partitionByCorrectness(answers);

        return {
            correct: correct.length,
            incorrect: incorrect.length,
            total: answers.length,
            percent: correct.length / answers.length,
            question
        };
    });

    const sortedStats = fullStats.sort((a, b) => a.percent - b.percent);
    if (ctx.opts.stat === "easiest") sortedStats.reverse();

    const topSortedStats = sortedStats.filter((s) => s.question).slice(0, 10);

    const embed = new MessageEmbed().setTitle(`${F.titleCase(ctx.opts.stat)} Verified Quiz Questions`);

    for (const stat of topSortedStats) {
        const questionName = stat.question.question.split("\n")[0];
        const [progress] = progressBar.filledBar(stat.total, stat.correct, 20);
        embed.addField(questionName, `${progress} [${stat.correct}/${stat.total}]`);
    }

    await ctx.send({ embeds: [embed.toJSON()] });
});

export default command;