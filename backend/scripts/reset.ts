import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma";
import { redisConnection } from "../src/lib/redis";
import { env } from "../src/config/env";

const TEAM = [
  { username: "paula", name: "Paula" },
  { username: "guilherme", name: "Guilherme" },
  { username: "gabriel", name: "Gabriel" },
];

async function wipe(): Promise<void> {
  await prisma.conversationMessage.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.logEvent.deleteMany();
  await prisma.lead.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.nativeAgent.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.webhookRegistration.deleteMany();
  await prisma.account.deleteMany();
  await prisma.calendarConnection.deleteMany();
  await prisma.sellerAvailability.deleteMany();
  await prisma.aiEvaluationRun.deleteMany();
  await prisma.appConfig.deleteMany();
  await prisma.user.deleteMany();
}

async function main(): Promise<void> {
  try {
    await redisConnection.flushall();
    console.log("Redis limpo (flushall).");
  } catch (err) {
    console.warn("Falha ao limpar Redis:", (err as Error).message);
  }

  await wipe();
  console.log("Banco zerado.");

  const adminHash = await bcrypt.hash(env.ADMIN_PASSWORD, 12);
  await prisma.user.create({
    data: {
      username: env.ADMIN_USERNAME,
      name: "Administrador",
      passwordHash: adminHash,
      whatsapp: env.WHATSAPP_SUPPORT || null,
      role: "ADMIN",
      status: "ACTIVE",
      pro: false,
    },
  });
  console.log(`Admin criado: ${env.ADMIN_USERNAME}`);

  const memberHash = await bcrypt.hash("2020", 12);
  for (const member of TEAM) {
    await prisma.user.create({
      data: {
        username: member.username,
        name: member.name,
        passwordHash: memberHash,
        role: "USER",
        status: "ACTIVE",
        pro: false,
      },
    });
    console.log(`Usuário criado: ${member.username} (senha 2020, sem PRO)`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await redisConnection.quit().catch(() => {});
  });
