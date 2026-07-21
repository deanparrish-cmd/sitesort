export * from "./generated/api";
export * from "./generated/types";

// `./generated/api` (zod schemas) and `./generated/types` (TS types) both emit
// `ListDocumentsParams` / `ListPhotosParams`, making the wildcard re-exports above
// ambiguous under declaration emit. Explicit named re-exports take precedence over
// `export *`, so re-export the zod schema values to resolve the collision (the matching
// types are redundant — derive them via `z.infer<typeof ListDocumentsParams>`).
export {
  ListDocumentsParams,
  ListPhotosParams,
  GetProjectActivityParams,
  PortalLoginResponse,
  ListSubcontractorPeopleParams,
  CreateSubcontractorPersonParams,
  DeletePersonParams,
  ListInHousePeopleParams,
  CreateInHousePersonParams,
  CreatePortalInviteParams,
  ListSubcontractorDocumentsParams,
  UploadPortalMyDocumentBody,
  DistributePlantItemBody,
  ListPlantItemsParams,
  UploadPortalPlantMaterialAttachmentBody,
  CreatePortalSiteIssueBody,
  UpdatePortalSiteIssueBody,
  GetPortalDmThreadParams,
  EditPortalSiteIssueDraftBody,
} from "./generated/api";
