# SiteSort visual audit

Read-only audit of the local SiteSort app at `http://localhost:8080` using the
documented demo account. No forms were submitted, invitations sent, contact
actions triggered, or existing data changed.

## Prioritized findings

1. **Responsive layout defect at tablet width (768px).** On `/dashboard` at
   768×900, the greeting/date area is squeezed and overlapped by the
   horizontally arranged quick actions; `Upload Doc` is visibly cut off at the
   right edge. Evidence: screenshot `w5zm3c`.
2. **Minor narrow-width compression on project Documents controls.** On the
   populated Test Project detail at 390×844, the 12-tab grid remains readable,
   but the Documents search placeholder is visibly shortened to “Search doc”
   beside the tightly positioned Upload Document control. Evidence:
   screenshot `2jdh31`.
3. **Non-blocking form accessibility warning.** The browser reports that the
   password input should include `autocomplete="current-password"` on login.

## Looked correct

- Desktop dashboard (1440×1000) is populated and aligned: metrics, compliance
  warnings, active projects, recent activity, and calendar.
- Desktop Projects list and populated project detail are aligned. All 12
  project tabs are visible in a readable two-row grid.
- Plant & Materials Add item modal opens without saving and shows three
  Dictate microphone controls; Site Issues shows its two microphone-enabled
  controls. The Plant fixture itself is empty.
- Desktop Contacts shows expanded groups and readable action pills; mobile
  Contacts cards and action-pill controls are present in the accessibility
  layout, with no observed horizontal overflow in the visible header/filter
  area.
- Desktop Notifications is populated with current activity and month folders;
  Team shows 20 members in role groups; Settings Profile is aligned.
- 360×800 dashboard remains readable with expected wrapping; 390×844
  dashboard and project tab grid fit without visible horizontal clipping.

## Limitations

- Contractor portal overview/sections could not be audited: `/portal/overview`
  redirected to `/portal/login`, and no existing portal session or safe demo
  credential was available. No temporary fixture was created.
- This was browser emulation at the requested viewport widths, not real iOS
  hardware testing. Animations/audio were not evaluated.