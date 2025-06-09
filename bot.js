import { Client,
     GatewayIntentBits, 
     Partials, 
     ModalBuilder,
     TextInputBuilder,
     TextInputStyle,
     ActionRowBuilder,
     REST, 
     Routes,
     SlashCommandBuilder 
    } from 'discord.js';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import nodemailer from 'nodemailer';
import * as dotenv from 'dotenv';
dotenv.config();

// getting values
const {
  DISCORD_TOKEN, GUILD_ID,
  ROLE_UNVERIFIED, ROLE_VERIFIED,
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
} = process.env;


// check if database exists if not then create
let db;
(async () => {
  db = await open({ filename: 'bot.db', driver: sqlite3.Database });
  const schema = await import('fs').then(fs => fs.readFileSync('schema.sql', 'utf8'));
  await db.exec(schema);
})();

// setup for sending mail using nodemailer

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: Number(SMTP_PORT),
  secure: false,
  auth: { user: SMTP_USER, pass: SMTP_PASS }
});

async function sendOtpEmail(to, otp) {
  await transporter.sendMail({
    from: `"Algopath Bot" <${SMTP_USER}>`,
    to,
    subject: 'Your Algopath Discord OTP',
    text: `Use this code to verify your Discord access: ${otp}\n\nValid for 5 minutes.`
  });
}

// random generating the otp of length 6 
function genOtp(len = 6) {
  return Array.from({ length: len }, () => Math.floor(Math.random() * 10)).join('');
}

// connecting the bot to the server 
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages
  ],
  partials: [Partials.Channel]
});

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  // register slash commands for this server
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  const commands = [
    new SlashCommandBuilder()
      .setName('verify')
      .setDescription('Start email verification'),
    new SlashCommandBuilder()
      .setName('otp')
      .setDescription('Submit your OTP')
      .addStringOption(opt => opt
        .setName('code')
        .setDescription('The 6-digit code')
        .setRequired(true))
  ].map(cmd => cmd.toJSON());

  await rest.put(
    Routes.applicationGuildCommands(client.user.id, GUILD_ID),
    { body: commands }
  );
});

// for new member it will redirect to the welcome channel where they will get to the verify channel
client.on('guildMemberAdd', member => {
  const welcomeChannel = member.guild.channels.cache.find(
    ch => ch.name === 'welcome' && ch.isTextBased()
  );
  if (welcomeChannel) {
    welcomeChannel.send({
      content: `👋 Welcome <@${member.id}>!\nPlease read the pinned message and head over to #verify to get started.`
    });
  }
});

client.login(DISCORD_TOKEN);
