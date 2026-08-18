import { Router } from "express"
import prisma from "../utils/prisma"
import bcrypt from "bcrypt"

const router = Router()

router.get('/', async (req, res) => {
    const users = await prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        include: { userGroups: { include: { group: true } } }
    })
    res.render('users/list', { title: 'Users', users})
})

router.get('/new', (req, res) => {
    res.render('users/new', { title: 'New User' })
})

router.post('/', async (req, res) => {
    try {
        const { name, email, password } = req.body
        const passwordHash = await bcrypt.hash(password, 10)
        
        const user = await prisma.user.create({ 
            data: { name, email, passwordHash } 
        })
        
        await prisma.auditLog.create({
            data: {
                eventType: 'user_created',
                result: 'success',
                userId: user.id,
                ipAddress: req.ip,
                metadata: { email, name }
            }
        })
        
        res.redirect('/users')
    } catch (error: any) {
        if (error.code === 'P2002') {
            res.render('users/new', { 
                title: 'New User', 
                error: 'Email already exists',
                formData: req.body 
            })
        } else {
            res.render('users/new', { 
                title: 'New User', 
                error: 'Failed to create user',
                formData: req.body 
            })
        }
    }
})

router.get('/:id/edit', async (req, res) => {
    try {
        const user = await prisma.user.findUniqueOrThrow({
            where: { id: req.params.id },
            include: { userGroups: { include: { group: true } } }
        })
        const allGroups = await prisma.group.findMany({ orderBy: { name: 'asc' } })
        res.render('users/edit', { title: 'Edit User', user, allGroups })
    } catch (error) {
        res.status(404).render('error', { 
            title: 'Not Found', 
            message: 'User not found' 
        })
    }
})

router.post('/:id', async (req, res) => {
    try {
        const { name, email, status, groupIds } = req.body
        const groupIdsArray = Array.isArray(groupIds) ? groupIds : (groupIds ? [groupIds] : [])
        
        await prisma.user.update({
            where: { id: req.params.id },
            data: { name, email, status }
        })
        
        await prisma.userGroup.deleteMany({ where: { userId: req.params.id } })
        
        if (groupIdsArray.length > 0) {
            await prisma.userGroup.createMany({
                data: groupIdsArray.map((groupId: string) => ({
                    userId: req.params.id,
                    groupId
                }))
            })
        }
        
        await prisma.auditLog.create({
            data: {
                eventType: 'user_updated',
                result: 'success',
                userId: req.params.id,
                ipAddress: req.ip,
                metadata: { name, email, status, groupCount: groupIdsArray.length }
            }
        })
        
        res.redirect('/users')
    } catch (error: any) {
        if (error.code === 'P2025') {
            res.status(404).render('error', { 
                title: 'Not Found', 
                message: 'User not found' 
            })
        } else {
            res.redirect('/users')
        }
    }
})

router.post('/:id/toggle', async (req, res) => {
    try {
        const user = await prisma.user.findUniqueOrThrow({ where: { id: req.params.id } })
        const newStatus = user.status === 'active' ? 'inactive' : 'active'
        
        await prisma.user.update({
            where: { id: req.params.id },
            data: { status: newStatus }
        })
        
        if (newStatus === 'inactive') {
            await prisma.ssoSession.updateMany({
                where: { userId: req.params.id, status: 'active' },
                data: {
                    status: 'revoked',
                    revokedAt: new Date(),
                    revokeReason: 'user_deactivated'
                }
            })
            
            await prisma.event.create({
                data: {
                    eventType: 'SessionRevoked',
                    userId: req.params.id,
                    payload: {
                        reason: 'user_deactivated'
                    }
                }
            })
        }
        
        await prisma.auditLog.create({
            data: {
                eventType: 'user_status_changed',
                result: 'success',
                userId: req.params.id,
                ipAddress: req.ip,
                metadata: { oldStatus: user.status, newStatus }
            }
        })
        
        res.redirect('/users')
    } catch (error) {
        res.status(404).render('error', { 
            title: 'Not Found', 
            message: 'User not found' 
        })
    }
})

router.post('/:id/delete', async (req, res) => {
    try {
        await prisma.user.delete({ where: { id: req.params.id } })
        
        await prisma.auditLog.create({
            data: {
                eventType: 'user_deleted',
                result: 'success',
                userId: req.params.id,
                ipAddress: req.ip
            }
        })
        
        res.redirect('/users')
    } catch (error) {
        res.status(404).render('error', { 
            title: 'Not Found', 
            message: 'User not found' 
        })
    }
})

export default router