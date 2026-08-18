import { Router } from "express"
import prisma from "../utils/prisma"
import bcrypt from "bcrypt"

const router = Router()

router.get('/', async (req, res) => {
    const applications = await prisma.application.findMany({
        orderBy: { createdAt: 'desc' },
        include: { redirectUris: true, policies: { include: { group: true } } }
    })
    res.render('applications/list', { title: 'Applications', applications})
})

router.get('/new', (req, res) => {
    res.render('applications/new', { title: 'New Application' })
})

router.post('/', async (req, res) => {
    try {
        const { name, clientId, clientSecret, launchUrl, logoutNotificationUrl } = req.body
        const clientSecretHash = clientSecret ? await bcrypt.hash(clientSecret, 10) : null
        
        const application = await prisma.application.create({ 
            data: { 
                name, 
                clientId, 
                clientSecretHash,
                launchUrl,
                logoutNotificationUrl 
            } 
        })
        
        await prisma.auditLog.create({
            data: {
                eventType: 'application_created',
                result: 'success',
                applicationId: application.id,
                ipAddress: req.ip,
                metadata: { name, clientId }
            }
        })
        
        res.redirect('/applications')
    } catch (error: any) {
        if (error.code === 'P2002') {
            res.render('applications/new', { 
                title: 'New Application', 
                error: 'Client ID already exists',
                formData: req.body 
            })
        } else {
            res.render('applications/new', { 
                title: 'New Application', 
                error: 'Failed to create application',
                formData: req.body 
            })
        }
    }
})

router.get('/:id/edit', async (req, res) => {
    try {
        const application = await prisma.application.findUniqueOrThrow({
            where: { id: req.params.id },
            include: { redirectUris: true, policies: { include: { group: true } } }
        })
        const allGroups = await prisma.group.findMany({ orderBy: { name: 'asc' } })
        res.render('applications/edit', { title: 'Edit Application', application, allGroups })
    } catch (error) {
        res.status(404).render('error', { 
            title: 'Not Found', 
            message: 'Application not found' 
        })
    }
})

router.post('/:id', async (req, res) => {
    try {
        const { name, clientId, status, launchUrl, logoutNotificationUrl, redirectUris, policyGroupIds } = req.body
        
        const oldPolicies = await prisma.applicationGroupPolicy.findMany({
            where: { applicationId: req.params.id }
        })
        const oldGroupIds = oldPolicies.map(p => p.groupId)
        
        await prisma.application.update({
            where: { id: req.params.id },
            data: { name, clientId, status, launchUrl, logoutNotificationUrl }
        })
        
        const uriArray = redirectUris ? redirectUris.split('\n').map((u: string) => u.trim()).filter((u: string) => u) : []
        await prisma.applicationRedirectUri.deleteMany({ where: { applicationId: req.params.id } })
        if (uriArray.length > 0) {
            await prisma.applicationRedirectUri.createMany({
                data: uriArray.map((uri: string) => ({
                    applicationId: req.params.id,
                    redirectUri: uri
                }))
            })
        }
        
        const groupIdsArray = Array.isArray(policyGroupIds) ? policyGroupIds : (policyGroupIds ? [policyGroupIds] : [])
        await prisma.applicationGroupPolicy.deleteMany({ where: { applicationId: req.params.id } })
        if (groupIdsArray.length > 0) {
            await prisma.applicationGroupPolicy.createMany({
                data: groupIdsArray.map((groupId: string) => ({
                    applicationId: req.params.id,
                    groupId,
                    effect: 'allow'
                }))
            })
        }
        
        const removedGroupIds = oldGroupIds.filter(id => !groupIdsArray.includes(id))
        
        if (removedGroupIds.length > 0) {
            const affectedUserGroups = await prisma.userGroup.findMany({
                where: { groupId: { in: removedGroupIds } },
                select: { userId: true }
            })
            const affectedUserIds = [...new Set(affectedUserGroups.map(ug => ug.userId))]
            
            for (const userId of affectedUserIds) {
                const userGroups = await prisma.userGroup.findMany({
                    where: { userId },
                    select: { groupId: true }
                })
                const userGroupIds = userGroups.map(ug => ug.groupId)
                
                const stillHasAccess = userGroupIds.some(gid => groupIdsArray.includes(gid))
                
                if (!stillHasAccess) {
                    await prisma.ssoSession.updateMany({
                        where: { userId, status: 'active' },
                        data: {
                            status: 'revoked',
                            revokedAt: new Date(),
                            revokeReason: 'policy_changed'
                        }
                    })
                    
                    await prisma.event.create({
                        data: {
                            eventType: 'AccessPolicyChanged',
                            userId,
                            applicationId: req.params.id,
                            payload: {
                                reason: 'policy_changed',
                                applicationId: req.params.id
                            }
                        }
                    })
                }
            }
        }
        
        await prisma.auditLog.create({
            data: {
                eventType: 'application_updated',
                result: 'success',
                applicationId: req.params.id,
                ipAddress: req.ip,
                metadata: { name, clientId, status, redirectUriCount: uriArray.length, policyCount: groupIdsArray.length }
            }
        })
        
        res.redirect('/applications')
    } catch (error: any) {
        if (error.code === 'P2025' || error.code === 'P2002') {
            res.status(404).render('error', { 
                title: 'Not Found', 
                message: 'Application not found or client ID already exists' 
            })
        } else {
            res.redirect('/applications')
        }
    }
})

router.post('/:id/toggle', async (req, res) => {
    try {
        const application = await prisma.application.findUniqueOrThrow({ where: { id: req.params.id } })
        const newStatus = application.status === 'active' ? 'inactive' : 'active'
        
        await prisma.application.update({
            where: { id: req.params.id },
            data: { status: newStatus }
        })
        
        await prisma.auditLog.create({
            data: {
                eventType: 'application_status_changed',
                result: 'success',
                applicationId: req.params.id,
                ipAddress: req.ip,
                metadata: { oldStatus: application.status, newStatus }
            }
        })
        
        res.redirect('/applications')
    } catch (error) {
        res.status(404).render('error', { 
            title: 'Not Found', 
            message: 'Application not found' 
        })
    }
})

router.post('/:id/delete', async (req, res) => {
    try {
        await prisma.application.delete({ where: { id: req.params.id } })
        
        await prisma.auditLog.create({
            data: {
                eventType: 'application_deleted',
                result: 'success',
                applicationId: req.params.id,
                ipAddress: req.ip
            }
        })
        
        res.redirect('/applications')
    } catch (error) {
        res.status(404).render('error', { 
            title: 'Not Found', 
            message: 'Application not found' 
        })
    }
})

export default router