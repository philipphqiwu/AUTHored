import { Router } from "express"
import prisma from "../utils/prisma"

const router = Router()

router.get('/', async (req, res) => {
    const groups = await prisma.group.findMany({
        orderBy: { createdAt: 'desc' },
        include: { userGroups: { include: { user: true } } }
    })
    res.render('groups/list', { title: 'Groups', groups})
})

router.get('/new', (req, res) => {
    res.render('groups/new', { title: 'New Group' })
})

router.post('/', async (req, res) => {
    try {
        const { name, description} = req.body
        const group = await prisma.group.create({ data: { name, description } })
        
        await prisma.auditLog.create({
            data: {
                eventType: 'group_created',
                result: 'success',
                ipAddress: req.ip,
                metadata: { name, description }
            }
        })
        
        res.redirect('/groups')
    } catch (error: any) {
        if (error.code === 'P2002') {
            res.render('groups/new', { 
                title: 'New Group', 
                error: 'Group name already exists',
                formData: req.body 
            })
        } else {
            res.render('groups/new', { 
                title: 'New Group', 
                error: 'Failed to create group',
                formData: req.body 
            })
        }
    }
})

router.get('/:id/edit', async (req, res) => {
    try {
        const group = await prisma.group.findUniqueOrThrow({
            where: { id: req.params.id },
            include: { userGroups: { include: { user: true } } }
        })
        res.render('groups/edit', { title: 'Edit Group', group })
    } catch (error) {
        res.status(404).render('error', { 
            title: 'Not Found', 
            message: 'Group not found' 
        })
    }
})

router.post('/:id', async (req, res) => {
    try {
        const { name, description } = req.body
        await prisma.group.update({
            where: { id: req.params.id },
            data: { name, description }
        })
        
        await prisma.auditLog.create({
            data: {
                eventType: 'group_updated',
                result: 'success',
                ipAddress: req.ip,
                metadata: { name, description }
            }
        })
        
        res.redirect('/groups')
    } catch (error: any) {
        if (error.code === 'P2025' || error.code === 'P2002') {
            res.status(404).render('error', { 
                title: 'Not Found', 
                message: 'Group not found or name already exists' 
            })
        } else {
            res.redirect('/groups')
        }
    }
})

router.post('/:id/delete', async (req, res) => {
    try {
        const policies = await prisma.applicationGroupPolicy.findMany({
            where: { groupId: req.params.id },
            select: { applicationId: true }
        })

        const userGroups = await prisma.userGroup.findMany({
            where: { groupId: req.params.id },
            select: { userId: true }
        })

        await prisma.group.delete({ where: { id: req.params.id } })

        const affectedUserIds = [...new Set(userGroups.map(ug => ug.userId))]
        const affectedAppIds = [...new Set(policies.map(p => p.applicationId))]

        for (const userId of affectedUserIds) {
            const remainingGroups = await prisma.userGroup.findMany({
                where: { userId },
                select: { groupId: true }
            })
            const remainingGroupIds = remainingGroups.map(ug => ug.groupId)

            for (const applicationId of affectedAppIds) {
                const allAppPolicies = await prisma.applicationGroupPolicy.findMany({
                    where: { applicationId },
                    select: { groupId: true }
                })
                const appGroupIds = allAppPolicies.map(p => p.groupId)
                const stillHasAccess = remainingGroupIds.some(gid => appGroupIds.includes(gid))

                if (!stillHasAccess) {
                    await prisma.event.create({
                        data: {
                            eventType: 'AccessPolicyChanged',
                            userId,
                            applicationId,
                            payload: {
                                reason: 'group_deleted',
                                applicationId
                            }
                        }
                    })
                }
            }
        }
        
        await prisma.auditLog.create({
            data: {
                eventType: 'group_deleted',
                result: 'success',
                ipAddress: req.ip
            }
        })
        
        res.redirect('/groups')
    } catch (error) {
        res.status(404).render('error', { 
            title: 'Not Found', 
            message: 'Group not found' 
        })
    }
})

export default router