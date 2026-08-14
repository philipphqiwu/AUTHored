import pkg from '@prisma/client'
const { PrismaClient } = pkg
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

async function main() {
  console.log('Starting seed...')

  // Hash password for test users
  const passwordHash = await bcrypt.hash('password123', 10)

  // Create users
  const alice = await prisma.user.upsert({
    where: { email: 'alice@example.com' },
    update: {},
    create: {
      name: 'Alice',
      email: 'alice@example.com',
      passwordHash,
      status: 'active'
    }
  })

  const bob = await prisma.user.upsert({
    where: { email: 'bob@example.com' },
    update: {},
    create: {
      name: 'Bob',
      email: 'bob@example.com',
      passwordHash,
      status: 'active'
    }
  })

  console.log('Created users:', alice.email, bob.email)

  // Create groups
  const appAGroup = await prisma.group.upsert({
    where: { name: 'app-a-users' },
    update: {},
    create: {
      name: 'app-a-users',
      description: 'Users who can access App A'
    }
  })

  const appBGroup = await prisma.group.upsert({
    where: { name: 'app-b-users' },
    update: {},
    create: {
      name: 'app-b-users',
      description: 'Users who can access App B'
    }
  })

  console.log('Created groups:', appAGroup.name, appBGroup.name)

  // Assign users to groups
  // Alice is in both groups
  await prisma.userGroup.upsert({
    where: {
      userId_groupId: {
        userId: alice.id,
        groupId: appAGroup.id
      }
    },
    update: {},
    create: {
      userId: alice.id,
      groupId: appAGroup.id
    }
  })

  await prisma.userGroup.upsert({
    where: {
      userId_groupId: {
        userId: alice.id,
        groupId: appBGroup.id
      }
    },
    update: {},
    create: {
      userId: alice.id,
      groupId: appBGroup.id
    }
  })

  // Bob is only in app-a-users group
  await prisma.userGroup.upsert({
    where: {
      userId_groupId: {
        userId: bob.id,
        groupId: appAGroup.id
      }
    },
    update: {},
    create: {
      userId: bob.id,
      groupId: appAGroup.id
    }
  })

  console.log('Assigned users to groups')

  // Create applications
  const appA = await prisma.application.upsert({
    where: { clientId: 'app-a-client-id' },
    update: {},
    create: {
      name: 'App A',
      clientId: 'app-a-client-id',
      clientSecretHash: await bcrypt.hash('app-a-client-secret', 10),
      status: 'active',
      launchUrl: 'http://localhost:3002',
      logoutNotificationUrl: 'http://localhost:3002/internal/logout'
    }
  })

  const appB = await prisma.application.upsert({
    where: { clientId: 'app-b-client-id' },
    update: {},
    create: {
      name: 'App B',
      clientId: 'app-b-client-id',
      clientSecretHash: await bcrypt.hash('app-b-client-secret', 10),
      status: 'active',
      launchUrl: 'http://localhost:3003',
      logoutNotificationUrl: 'http://localhost:3003/internal/logout'
    }
  })

  console.log('Created applications:', appA.name, appB.name)

  // Create redirect URIs
  await prisma.applicationRedirectUri.upsert({
    where: { id: 'app-a-redirect-1' },
    update: {},
    create: {
      id: 'app-a-redirect-1',
      applicationId: appA.id,
      redirectUri: 'http://localhost:3002/callback'
    }
  })

  await prisma.applicationRedirectUri.upsert({
    where: { id: 'app-b-redirect-1' },
    update: {},
    create: {
      id: 'app-b-redirect-1',
      applicationId: appB.id,
      redirectUri: 'http://localhost:3003/callback'
    }
  })

  console.log('Created redirect URIs')

  // Create access policies
  await prisma.applicationGroupPolicy.upsert({
    where: {
      applicationId_groupId_effect: {
        applicationId: appA.id,
        groupId: appAGroup.id,
        effect: 'allow'
      }
    },
    update: {},
    create: {
      applicationId: appA.id,
      groupId: appAGroup.id,
      effect: 'allow'
    }
  })

  await prisma.applicationGroupPolicy.upsert({
    where: {
      applicationId_groupId_effect: {
        applicationId: appB.id,
        groupId: appBGroup.id,
        effect: 'allow'
      }
    },
    update: {},
    create: {
      applicationId: appB.id,
      groupId: appBGroup.id,
      effect: 'allow'
    }
  })

  console.log('Created access policies')
  console.log('Seed completed successfully!')
}

main()
  .catch((e) => {
    console.error('Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
