// Vollständige, ausgedachte Praxisdaten (Form wie /public/settings etc. des Backends).
const L = t => ({ de: t, hu: t + ' (hu)', en: t + ' (en)' });
const settings = {
  practice_name: 'Ordination Dr. Test', practice_full_name: 'Ordination Dr. Anna Test & Dr. Paul Probe',
  practice_street: 'Probegasse', practice_house_number: '5/2', practice_zip: '1230', practice_city: 'Wien',
  practice_address: 'Probegasse 5/2, 1230 Wien', practice_phone: '+43 1 555 12 34', practice_phone_link: '+43155512134',
  practice_email: 'ordi@probe.example', practice_website: 'https://www.probe.example',
  practice_specialty_legal: 'Fachärzte für Probe', portal_color_primary: '#336699', portal_color_accent: '#cc9944',
  enabled_languages: '["de","hu","en"]',
  website_services: JSON.stringify([{ name: L('Vorsorge'), desc: L('Beschreibung A') }, { name: L('Beratung'), desc: L('Beschreibung B') }]),
  website_hero_stats: JSON.stringify([{ value: '100+', label: L('Patient:innen') }]),
  // Die Seite hat feste Plätze für genau 3 Bewertungen; weniger lässt die Vorlagen-Bewertungen stehen.
  website_reviews: JSON.stringify([1, 2, 3].map(i => ({ name: 'Maria T. ' + i, rating: 5, text: L('Sehr freundlich ' + i) }))),
  website_doctor_bios: JSON.stringify({ anna: { bio: L('Bio Anna'), schwerpunkte: { de: ['A'], hu: ['A'], en: ['A'] } } }),
  website_directions: JSON.stringify(L('Mit der U1 bis Probeplatz')),
  website_docfinder_url: 'https://www.docfinder.at/arzt/test',
};
const data = {
  '/public/settings': { status: 'ok', settings },
  '/public/opening-hours': { data: [
    { id: 1, user_id: 1, schedule_key: 'anna', display_name: 'Dr. Anna Test', kassen: '["oegk"]', hours: [{ weekday: 1, time_from: '09:00', time_to: '12:00' }, { weekday: 3, time_from: '14:00', time_to: '18:00' }] },
    { id: 2, user_id: 2, schedule_key: 'paul', display_name: 'Dr. Paul Probe', kassen: '[]', hours: [{ weekday: 3, time_from: '14:00', time_to: '18:00' }] },
  ] },
  '/public/staff': { status: 'ok', data: [{ id: 3, display_name: 'Berta Assistenz' }] },
  '/public/staff-bios': { status: 'ok', staff: [
    { id: 1, role: 'doctor', schedule_key: 'anna', display_name: 'Dr. Anna Test', bio: L('BIO-ANNA'), schwerpunkte: { de: ['Vorsorge'], hu: [], en: [] } },
    { id: 3, role: 'assistant', display_name: 'Berta Assistenz', bio: L('BIO-BERTA') } ] },
  '/public/website-photos': { status: 'ok', photos: [{ id: 31, user_id: 1, category: 'user' }, { id: 33, user_id: 3, category: 'user' }] },
};
module.exports = { settings, data };
