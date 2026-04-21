import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import projectsRouter from "./projects";
import documentsRouter from "./documents";
import teamRouter from "./team";
import subcontractorsRouter from "./subcontractors";
import permitsRouter from "./permits";
import photosRouter from "./photos";
import complianceRouter from "./compliance";
import notificationsRouter from "./notifications";
import usersRouter from "./users";
import qrRouter from "./qr";
import aiRouter from "./ai";
import uploadRouter from "./upload";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(projectsRouter);
router.use(documentsRouter);
router.use(teamRouter);
router.use(subcontractorsRouter);
router.use(permitsRouter);
router.use(photosRouter);
router.use(complianceRouter);
router.use(notificationsRouter);
router.use(usersRouter);
router.use(qrRouter);
router.use(aiRouter);
router.use(uploadRouter);

export default router;
