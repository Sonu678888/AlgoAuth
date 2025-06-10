console.log("Starting point");

const {
  Client,
  GatewayIntentBits,
  Partials,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
} = require("discord.js");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const nodemailer = require("nodemailer");
const dotenv = require("dotenv");
const fs = require("fs");

dotenv.config();

const {
  DISCORD_TOKEN,
  GUILD_ID,
  ROLE_UNVERIFIED,
  ROLE_VERIFIED,
  WELCOME_CHANNEL_ID,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
} = process.env;

console.log("▶️ Starting the bot and DB initialization…");

process.on("unhandledRejection", (error) => {
  console.error("Unhandled error please check !", error);
});

let db;
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.Channel],
});

(async () => {
  try {
    // Initialize the database
    console.log("  • Opening SQLite database…");
    db = await open({ filename: "bot.db", driver: sqlite3.Database });
    console.log("  • Reading schema.sql…");
    const schema = fs.readFileSync("schema.sql", "utf8");
    console.log("  • Executing schema…");
    await db.exec(schema);
    console.log("✅ Database is ready.");

    // Set up email transporter
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: parseInt(SMTP_PORT),
      secure: false,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });

    // this will generate random otp of length 6
    function genOtp(len = 6) {
      return Array.from({ length: len }, () =>
        Math.floor(Math.random() * 10)
      ).join("");
    }

    async function sendOtpEmail(to, otp) {
      await transporter.sendMail({
        from: `AlgoAuth Bot <${SMTP_USER}>`,
        to,
        subject: "Your Algopath Discord OTP",
        text: `Your verification code is: ${otp}\nExpires in 5 minutes.`,
      });
    }

    // Bot has been successfully connected to the server
    client.once("ready", async () => {
      console.log(`✅ Logged in as ${client.user.tag}`);
    });

    //  this will triger when a new member is joined
    client.on("guildMemberAdd", async (member) => {
      try {
        await member.roles.add(ROLE_UNVERIFIED);
      } catch (e) {
        console.error("Error adding role:", e);
      }

      const welcomeChannel =
        member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
      if (welcomeChannel && welcomeChannel.type === "GUILD_TEXT") {
        welcomeChannel.send(
          `👋 Welcome <@${member.id}>! Read the pinned message, then go to #verify.`
        );
      } else {
        console.error("Go and get yourself verified !");
      }
    });

    // this will handle all the interactions
    client.on("interactionCreate", async (interaction) => {
      try {
        // this checks whether already we have verified the user
        if (
          interaction.isChatInputCommand() &&
          interaction.commandName === "verify"
        ) {
          const userRow = await db.get(
            `SELECT verified FROM users WHERE discord_id = ?`,
            interaction.user.id
          );

          const guild = client.guilds.cache.get(GUILD_ID);
          const member = await guild.members.fetch(interaction.user.id);
          const hasVerifiedRole = member.roles.cache.has(ROLE_VERIFIED);

          if (userRow?.verified === 1 && hasVerifiedRole) {
            return interaction.reply({
              content: "✅ You are already verified!",
              ephemeral: true,
            });
          }

          if (userRow?.verified === 1 && !hasVerifiedRole) {
            await member.roles.add(ROLE_VERIFIED);
            await member.roles.remove(ROLE_UNVERIFIED);
            return interaction.reply({
              content:
                "✅ You were already verified. Verified role has been re-added.",
              ephemeral: true,
            });
          }

          return interaction.showModal(
            new ModalBuilder()
              .setCustomId("verify_modal")
              .setTitle("Algopath Verification")
              .addComponents(
                new ActionRowBuilder().addComponents(
                  new TextInputBuilder()
                    .setCustomId("email")
                    .setLabel("Your Email")
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder("you@gmail.com")
                    .setRequired(true)
                )
              )
          );
        }

        // this will trigger when user will submit the details using the command

        if (
          interaction.isModalSubmit() &&
          interaction.customId === "verify_modal"
        ) {
          await interaction.deferReply({ ephemeral: true });

          const email = interaction.fields.getTextInputValue("email").trim();
          if (!email.endsWith("@gmail.com")) {
            return interaction.editReply({ content: "❌ Email is not valid " });
          }

          const otp = genOtp();
          const expires = Math.floor(Date.now() / 1000) + 300; // will be valid for 5 mins
          await db.run(
            `INSERT INTO users(discord_id,email) VALUES(?,?)
             ON CONFLICT(discord_id) DO UPDATE SET email=excluded.email`,
            interaction.user.id,
            email
          );
          await db.run(
            `INSERT OR REPLACE INTO otps(discord_id,code,expires_at) VALUES(?,?,?)`,
            interaction.user.id,
            otp,
            expires
          );
          await sendOtpEmail(email, otp);

          await interaction.editReply({
            content: "✉️ OTP sent! Use `/otp code:<code>` within 5 minutes.",
          });
        }
        // this will be triggered when user will submit the code
        if (
          interaction.isChatInputCommand() &&
          interaction.commandName === "otp"
        ) {
          await interaction.deferReply({ ephemeral: true });

          const code = interaction.options.getString("code")?.trim();
          const row = await db.get(
            "SELECT expires_at FROM otps WHERE discord_id = ? AND code = ?",
            interaction.user.id,
            code
          );

          if (!row || row.expires_at < Math.floor(Date.now() / 1000)) {
            return interaction.editReply({
              content: "❌ Invalid or expired OTP.",
            });
          }

          const guild = client.guilds.cache.get(GUILD_ID);
          const member = await guild.members.fetch(interaction.user.id);

          await member.roles.add(ROLE_VERIFIED); // if everything is fine then it will change the role to verified
          await member.roles.remove(ROLE_UNVERIFIED);

          await db.run(
            "UPDATE users SET verified=1 WHERE discord_id = ?",
            interaction.user.id
          );
          await db.run(
            "DELETE FROM otps WHERE discord_id = ?",
            interaction.user.id
          );

          await interaction.editReply({
            content: "🎉 You’re now verified! Go and explore the community",
          });

          const welcomeChannel = guild.channels.cache.get(WELCOME_CHANNEL_ID);
          if (welcomeChannel?.isTextBased?.()) {
            welcomeChannel.send(
              `🎊 <@${interaction.user.id}> is now verified—welcome aboard!`
            );
          }
        }
      } catch (err) {
        console.error("❌ Error handling interaction:", err);
        if (interaction.isRepliable()) {
          interaction.reply({
            content: "⚠️ Something went wrong.",
            ephemeral: true,
          });
        }
      }
    });

    // Start the bot
    console.log("  • Logging in Discord...");
    await client.login(DISCORD_TOKEN);
  } 
  catch (err) {
    console.error("❌ Error during startup:", err);
  }
})();

const express = require("express");
const app = express();

app.get("/", (req, res) => {
  res.send("✅ Discord bot is running!");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Algoauth server listening on port ${PORT}`);
});