// bot.js
console.log("Starting point");

const {
  Client,
  GatewayIntentBits,
  Partials,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const nodemailer = require("nodemailer");
const dotenv = require("dotenv");
const fs = require("fs");
const express = require("express");

dotenv.config();
const {
  DISCORD_TOKEN,
  GUILD_ID,
  ROLE_UNVERIFIED,
  ROLE_VERIFIED,
  VERIFY_CHANNEL_ID,
  WELCOME_CHANNEL_ID,
} = process.env;

const genOtp = (len = 6) =>
  Array.from({ length: len }, () => Math.floor(Math.random() * 10)).join("");

(async () => {
  const db = await open({ filename: "bot.db", driver: sqlite3.Database });
  const schema = fs.readFileSync("schema.sql", "utf8");
  await db.exec(schema);
  console.log("✅ Database ready");

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: +process.env.SMTP_PORT,
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
    partials: [Partials.Channel],
  });

  client.once("ready", async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);

    // this will post the welcome message
    try {
      const welcomeCh = client.channels.cache.get(WELCOME_CHANNEL_ID);
      const recent = await welcomeCh.messages.fetch({ limit: 20 });
      const alreadyPosted = recent.some(
        (msg) =>
          msg.author.id === client.user.id &&
          msg.content.includes("👋 Welcome to Algopath")
      );

      if (!alreadyPosted) {
        await welcomeCh.send(
          "👋 Welcome to Algopath Community!\nTo get started, please go to <#" +
            VERIFY_CHANNEL_ID +
            "> and click the verify button."
        );
      }
    } catch (e) {
      console.error("⚠️ Failed to post welcome message:", e);
    }

    // Post Verify Button in #verify
    try {
      const verifyCh = client.channels.cache.get(VERIFY_CHANNEL_ID);
      const recent = await verifyCh.messages.fetch({ limit: 10 });
      const alreadyPosted = recent.some(
        (msg) =>
          msg.author.id === client.user.id &&
          msg.content.includes("🔒 Verify to join")
      );

      if (!alreadyPosted) {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("btn_verify")
            .setLabel("🔑 Verify Email")
            .setStyle(ButtonStyle.Primary)
        );
        await verifyCh.send({
          content: "🔒 Verify to join",
          components: [row],
        });
      }
    } catch (e) {
      console.error("⚠️ Failed to post verify button in #verify:", e);
    }

    // Post Ask button once
    try {
      const ch = client.channels.cache.find((c) => c.name === "ask-doubts");
      if (!ch?.isTextBased()) return;

      const pinned = await ch.messages.fetchPinned();
      const alreadyPinned = pinned.some(
        (msg) =>
          msg.author.id === client.user.id &&
          msg.content.includes("📌 Got doubts?")
      );

      if (!alreadyPinned) {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("btn_ask")
            .setLabel("❓ Ask Doubt")
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId("btn_view_doubts")
            .setLabel("📋 View Doubts")
            .setStyle(ButtonStyle.Primary)
        );

        const message = await ch.send({
          content: "📌 Got doubts? Use the buttons below anytime:",
          components: [row],
        });

        await message.pin().catch(console.error);
      }
    } catch (e) {
      console.error("⚠️ Failed to pin ask/view buttons in #ask-doubts:", e);
    }
  });

  client.on("guildMemberAdd", async (m) => {
    try {
      const row = await db.get(
        "SELECT verified FROM users WHERE discord_id = ?",
        m.id
      );

      if (row?.verified) {
        await m.roles.add(ROLE_VERIFIED).catch(console.error);
        await m.roles.remove(ROLE_UNVERIFIED).catch(() => {}); // Remove unverified if present
      } else {
        await m.roles.add(ROLE_UNVERIFIED).catch(console.error);
        await m.roles.remove(ROLE_VERIFIED).catch(() => {}); // Remove verified if present
      }
    } catch (err) {
      console.error("❌ Error in guildMemberAdd:", err);
    }
  });

  client.on("interactionCreate", async (i) => {
    try {
      if (i.isButton() && i.customId === "btn_verify") {
        return i.showModal(
          new ModalBuilder()
            .setCustomId("mdl_email")
            .setTitle("Enter Email")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("email")
                  .setLabel("Algopath Email")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(true)
              )
            )
        );
      }

      // this will trigger when enter email is clicked
      if (i.isModalSubmit() && i.customId === "mdl_email") {
        await i.deferReply({ flags: 64 });
        const email = i.fields.getTextInputValue("email").trim();
        if (!email.endsWith("@gmail.com")) {
          return i.editReply("❌ Must use @gmail.com");
        }
        const otp = genOtp();
        const exp = Date.now() + 5 * 60 * 1000;
        await db.run(
          `INSERT OR REPLACE INTO otps(discord_id,code,expires_at) VALUES(?,?,?);`,
          i.user.id,
          otp,
          exp
        );
        transporter
          .sendMail({
            from: process.env.SMTP_USER,
            to: email,
            subject: "OTP",
            text: `Code: ${otp}`,
          })
          .catch(console.error);

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("btn_otp")
            .setLabel("✉️ Enter OTP")
            .setStyle(ButtonStyle.Success)
        );
        return i.editReply({
          content: "✉️ OTP sent to the provided email—click below",
          components: [row],
        });
      }

      if (i.isButton() && i.customId === "btn_otp") {
        return i.showModal(
          new ModalBuilder()
            .setCustomId("mdl_otp")
            .setTitle("Enter OTP")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("otp")
                  .setLabel("6-digit Code")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(true)
              )
            )
        );
      }

      // this will trigger when enter otp is clicked

      if (i.isModalSubmit() && i.customId === "mdl_otp") {
        await i.deferReply({ flags: 64 });
        const code = i.fields.getTextInputValue("otp").trim();
        const row = await db.get(
          `SELECT expires_at FROM otps WHERE discord_id=? AND code=?;`,
          i.user.id,
          code
        );
        if (!row || row.expires_at < Date.now()) {
          return i.editReply("❌ Invalid/expired OTP");
        }
        const g = client.guilds.cache.get(GUILD_ID);
        const m = await g.members.fetch(i.user.id);
        await m.roles.add(ROLE_VERIFIED);
        await m.roles.remove(ROLE_UNVERIFIED);
        return i.editReply(
          "✅ Verified! Now you can explore the community 😀."
        );
      }

      if (i.isButton() && i.customId === "btn_ask") {
        return i.showModal(
          new ModalBuilder()
            .setCustomId("mdl_ask")
            .setTitle("Your Doubt")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("question")
                  .setLabel("Question")
                  .setStyle(TextInputStyle.Paragraph)
                  .setRequired(true)
              )
            )
        );
      }
      // this will trigger when view doubt button is clicked

      if (i.isButton() && i.customId === "btn_view_doubts") {
        try {
          const doubts = await db.all(
            `SELECT id, username, question FROM doubts
       WHERE status='open'
       ORDER BY created_at DESC LIMIT 5;`
          );

          if (!doubts.length) {
            return i.reply({
              content: "📭 No open doubts at the moment.",
              ephemeral: true,
            });
          }

          const list = doubts
            .map(
              (d) =>
                `🆔 #${d.id} by **${d.username}**\n> ${d.question.slice(0, 80)}`
            )
            .join("\n\n");

          return i.reply({
            content: `📋 **Open Doubts:**\n\n${list}`,
            ephemeral: true,
          });
        } catch (err) {
          console.error("⚠️ Failed to fetch doubts:", err);
          return i.reply({
            content: "⚠️ Couldn't fetch doubts. Try again later.",
            ephemeral: true,
          });
        }
      }

      // this will trigger when ask doubt button is clicked

      if (i.isModalSubmit() && i.customId === "mdl_ask") {
        await i.deferReply({ flags: 64 });
        const q = i.fields.getTextInputValue("question").trim();

        // rate-limit check BEFORE insertion
        const recent = await db.get(
          `SELECT created_at FROM doubts WHERE discord_id=? ORDER BY created_at DESC LIMIT 1`,
          i.user.id
        );
        if (recent && Date.now() - recent.created_at < 2 * 60 * 1000) {
          return i.editReply(
            "⏳ Please wait a couple of minutes before asking another doubt."
          );
        }

        const ts = Date.now();
        await db.run(
          `INSERT INTO doubts(discord_id,username,question,created_at) VALUES(?,?,?,?);`,
          i.user.id,
          i.user.tag,
          q,
          ts
        );

        const { id } = await db.get(`SELECT last_insert_rowid() AS id;`);
        const openCh = client.channels.cache.find(
          (c) => c.name === "open-doubts"
        );
        if (openCh?.isTextBased()) {
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`btn_solve_${id}`)
              .setLabel("💡 Solve")
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId(`btn_close_${id}_${i.user.id}`)
              .setLabel("🔒 Close")
              .setStyle(ButtonStyle.Danger)
              .setDisabled(true)
          );
          await openCh.send({
            content: `🆔 **#${id}** by <@${i.user.id}>:\n> ${q}`,
            components: [row],
          });
        }
        return i.editReply(`✅ Doubt #${id} posted.`);
      }

      if (i.isButton() && i.customId.startsWith("btn_close_")) {
        const parts = i.customId.split("_");
        const id = parseInt(parts[2]);
        const ownerId = parts[3];

        if (i.user.id !== ownerId) {
          return i.reply({
            content: "❌ Only the author of this doubt can close it.",
            flags: 64,
          });
        }

        await i.deferReply({ flags: 64 });

        const r = await db.get("SELECT discord_id FROM doubts WHERE id=?;", id);
        if (!r || r.discord_id !== i.user.id) {
          return i.editReply(`❌ You're not authorized to close #${id}`);
        }

        await db.run("UPDATE doubts SET status='resolved' WHERE id=?;", id);

        const openCh = client.channels.cache.find(
          (c) => c.name === "open-doubts"
        );
        const resCh = client.channels.cache.find(
          (c) => c.name === "resolved-doubts"
        );

        const msgs = await openCh.messages.fetch({ limit: 50 });
        const msg = msgs.find((m) => m.content.includes(`**#${id}**`));
        if (msg) {
          await resCh.send(`✅ **Resolved #${id}**\n${msg.content}`);
          await msg.delete();
        }

        return i.editReply(
          `🎉 Doubt #${id} closed and moved to #resolved-doubts.`
        );
      }

      if (i.isButton() && i.customId.startsWith("btn_solve_")) {
        const id = parseInt(i.customId.split("_")[2]);
        return i.showModal(
          new ModalBuilder()
            .setCustomId(`mdl_solve_${id}`)
            .setTitle(`Answer Doubt #${id}`)
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("answer")
                  .setLabel("Your Solution")
                  .setStyle(TextInputStyle.Paragraph)
                  .setRequired(true)
              )
            )
        );
      }

      // this will trigger when solve  button is clicked
      if (i.isModalSubmit() && i.customId.startsWith("mdl_solve_")) {
        await i.deferReply({ flags: 64 });
        const id = parseInt(i.customId.split("_")[2]);
        const ans = i.fields.getTextInputValue("answer").trim();

        const doubt = await db.get(
          "SELECT discord_id FROM doubts WHERE id=? AND status='open';",
          id
        );
        if (!doubt) return i.editReply("❌ No open doubt found.");

        await db.run(
          `INSERT INTO solutions(doubt_id,solver_id,answer,created_at) VALUES(?,?,?,?)`,
          id,
          i.user.id,
          ans,
          Date.now()
        );
        const op = await client.users.fetch(doubt.discord_id);
        await op.send(`💡 Answer to your Doubt #${id}:\n${ans}`);

        const openCh = client.channels.cache.find(
          (c) => c.name === "open-doubts"
        );
        if (openCh?.isTextBased()) {
          const msgs = await openCh.messages.fetch({ limit: 50 });
          const msg = msgs.find((m) => m.content.includes(`**#${id}**`));
          if (msg) {
            const row = msg.components[0];
            const newRow = new ActionRowBuilder().addComponents(
              row.components.map((comp, idx) => {
                if (idx === 1)
                  return ButtonBuilder.from(comp).setDisabled(false);
                return ButtonBuilder.from(comp);
              })
            );
            await msg.edit({ components: [newRow] });
          }
        }

        return i.editReply(`✅ Sent solution to <@${doubt.discord_id}>.`);
      }
    } catch (err) {
      console.error("⚠️ Error in interaction:", err);
      if (i.isRepliable()) {
        i.reply({ content: "⚠️ Unexpected error", ephemeral: true });
      }
    }
  });

  await client.login(DISCORD_TOKEN);
})();

const app = express();

app.get("/", (req, res) => {
  res.send("✅ Discord bot is running!");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Algoauth server listening on port ${PORT}`);
});
