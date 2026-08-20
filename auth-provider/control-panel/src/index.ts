import 'dotenv/config'
import express from 'express'
import path from 'path'
import cookieParser from 'cookie-parser'
import expressLayouts from 'express-ejs-layouts'

import { fileURLToPath } from 'url'
import { dirname } from 'path'

import routes from './routes/index'
import authRoutes from './routes/auth'
import healthRoutes from './routes/health'
import { requireAuth } from './middleware/auth'
import prisma from './utils/prisma'

const app = express()
const PORT = process.env.PORT || 3001
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, 'views'))

app.use(expressLayouts);
app.set('layout', 'layout')
app.use(express.json())
app.use(express.urlencoded({extended: true}))
app.use(cookieParser())
app.use('/css', express.static(path.join(__dirname, '../public/css')))

app.use('/', healthRoutes)
app.use('/', authRoutes)

app.use(requireAuth)

app.get('/', async (req, res) => {
    const [userCount, groupCount, appCount] = await Promise.all([
        prisma.user.count(),
        prisma.group.count(),
        prisma.application.count()
    ])
    res.render('dashboard', {title: 'Dashboard', userCount, groupCount, appCount})
})

app.use('/', routes)

const server = app.listen(PORT, () => {
    console.log(`Control Panel running on http://localhost:${PORT}`)
})

const shutdown = (signal: string) => {
    console.log(`Control Panel received ${signal}, shutting down gracefully...`)
    server.close(async () => {
        await prisma.$disconnect()
        process.exit(0)
    })
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
