require("dotenv").config();
const bcrypt = require("bcrypt");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  // Clean old data (children first)
  await prisma.activityLog.deleteMany();
  await prisma.task.deleteMany();
  await prisma.column.deleteMany();
  await prisma.board.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.tenant.deleteMany();
  await prisma.organization.deleteMany();

  const passwordHash = await bcrypt.hash("password123", 10);

  // Organizations
  const abc = await prisma.organization.create({
    data: { name: "ABC Technologies" },
  });
  const xyz = await prisma.organization.create({
    data: { name: "XYZ Solutions" },
  });

  // Tenants (branches)
  const hyd = await prisma.tenant.create({
    data: { name: "Hyderabad", organizationId: abc.id },
  });
  const blr = await prisma.tenant.create({
    data: { name: "Bangalore", organizationId: abc.id },
  });
  await prisma.tenant.create({
    data: { name: "Chennai", organizationId: abc.id },
  });
  const mum = await prisma.tenant.create({
    data: { name: "Mumbai", organizationId: xyz.id },
  });
  await prisma.tenant.create({
    data: { name: "Pune", organizationId: xyz.id },
  });

  // Users
  const mk = (name, email) =>
    prisma.user.create({ data: { name, email, passwordHash } });
  const rahul = await mk("Rahul", "rahul@abc.com");
  const priya = await mk("Priya", "priya@abc.com");
  const arjun = await mk("Arjun", "arjun@abc.com");
  const sneha = await mk("Sneha", "sneha@abc.com");
  const kiran = await mk("Kiran", "kiran@xyz.com");

  // Memberships (tenantId null = organization-level)
  await prisma.membership.createMany({
    data: [
      {
        userId: rahul.id,
        organizationId: abc.id,
        tenantId: null,
        role: "ORG_ADMIN",
      },
      {
        userId: priya.id,
        organizationId: abc.id,
        tenantId: hyd.id,
        role: "TENANT_ADMIN",
      },
      {
        userId: arjun.id,
        organizationId: abc.id,
        tenantId: hyd.id,
        role: "MEMBER",
      },
      {
        userId: sneha.id,
        organizationId: abc.id,
        tenantId: blr.id,
        role: "TENANT_ADMIN",
      },
      {
        userId: kiran.id,
        organizationId: xyz.id,
        tenantId: mum.id,
        role: "MEMBER",
      },
    ],
  });

  // Helper: board + 4 columns + tasks
  async function makeBoard(org, tenant, creator, name, tasks) {
    const board = await prisma.board.create({
      data: {
        organizationId: org.id,
        tenantId: tenant.id,
        name,
        createdBy: creator.id,
      },
    });
    const names = ["To Do", "In Progress", "Testing", "Done"];
    const cols = [];
    for (let i = 0; i < names.length; i++) {
      cols.push(
        await prisma.column.create({
          data: {
            boardId: board.id,
            tenantId: tenant.id,
            name: names[i],
            position: i + 1,
          },
        }),
      );
    }
    const counters = [0, 0, 0, 0];
    for (const [title, colIdx, assignee, priority] of tasks) {
      counters[colIdx] += 1;
      await prisma.task.create({
        data: {
          boardId: board.id,
          columnId: cols[colIdx].id,
          tenantId: tenant.id,
          title,
          description: `Details for: ${title}`,
          priority,
          assignedTo: assignee ? assignee.id : null,
          position: counters[colIdx] * 1000,
        },
      });
    }
  }

  await makeBoard(abc, hyd, priya, "Website Development", [
    ["Create Login Page", 0, rahul, "HIGH"],
    ["Fix API Validation", 0, arjun, "MEDIUM"],
    ["Design Dashboard", 0, priya, "LOW"],
    ["Develop Registration API", 1, arjun, "HIGH"],
    ["Build Navbar", 1, rahul, "MEDIUM"],
    ["Test Authentication", 2, priya, "HIGH"],
    ["Deploy Dashboard", 3, rahul, "MEDIUM"],
  ]);

  await makeBoard(abc, hyd, priya, "Mobile App Development", [
    ["Setup React Native", 0, arjun, "MEDIUM"],
    ["Push Notifications", 1, priya, "HIGH"],
    ["App Store Listing", 3, rahul, "LOW"],
  ]);

  await makeBoard(abc, blr, sneha, "CRM Development", [
    ["Customer List Page", 0, sneha, "HIGH"],
    ["Import Contacts", 1, sneha, "MEDIUM"],
    ["Email Templates", 3, sneha, "LOW"],
  ]);

  await makeBoard(xyz, mum, kiran, "Customer Support Platform", [
    ["Ticket Form", 0, kiran, "HIGH"],
    ["Live Chat Widget", 1, kiran, "MEDIUM"],
    ["FAQ Page", 3, kiran, "LOW"],
  ]);

  console.log("Seed complete. All passwords: password123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
