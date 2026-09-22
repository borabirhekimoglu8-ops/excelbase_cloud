/**
 * Single local country table for passport scan.
 *
 * ISO 3166-1 alpha-2 / alpha-3 / English short names plus ICAO 9303
 * exceptions. Shipped with the PWA; no network lookup and no passenger
 * data leaves the device.
 *
 * Retrieval date: 2026-09-22. See COUNTRY_TABLE_SOURCES below.
 */

export const COUNTRY_TABLE_SOURCES = Object.freeze({
  retrievedAt: "2026-09-22",
  iso: {
    title: "ISO 3166-1 country codes",
    urls: [
      "https://www.iso.org/iso-3166-country-codes.html",
      "https://www.iso.org/obp/ui/#search/code/",
    ],
    terms:
      "ISO publishes alpha-2/alpha-3 codes on the Online Browsing Platform. ISO states the alpha-2 list is free for internal use and non-commercial purposes; the paid Country Codes Collection is the official machine-readable product. This snapshot is a fact table of codes and short names for offline operator use, not a redistribution of the ISO Collection XML/CSV product.",
  },
  unM49: {
    title: "UN M49 standard country or area codes",
    urls: [
      "https://unstats.un.org/unsd/methodology/m49/",
      "https://unstats.un.org/unsd/methodology/m49/overview/",
    ],
    terms:
      "The United Nations Statistics Division assigns numeric M49 codes and English short names that ISO 3166/MA uses when notifying new members. Public statistical methodology; no passenger data is sent to this service at runtime.",
  },
  isoNamesSnapshot: {
    title: "ISO 3166 English short names (UN-derived snapshot)",
    urls: [
      "https://github.com/lukes/ISO-3166-Countries-with-Regional-Codes",
      "https://raw.githubusercontent.com/lukes/ISO-3166-Countries-with-Regional-Codes/master/all/all.csv",
    ],
    terms:
      "Community snapshot compiled from the UN Statistics Division M49 list. Used only to attach English short names to the existing local alpha-3→alpha-2 map. Retrieved 2026-09-22.",
  },
  turkishUiNames: {
    title: "Turkish display names (Unicode CLDR / country-list)",
    urls: [
      "https://github.com/umpirsky/country-list",
      "https://raw.githubusercontent.com/umpirsky/country-list/master/data/tr_TR/country.json",
    ],
    terms:
      "CLDR-derived Turkish short names for the operator picker only. Not an ISO official translation. Unicode CLDR license; local snapshot, no runtime fetch.",
  },
  icao9303: {
    title: "ICAO Doc 9303 Part 3, 8th edition (2021), Section 5",
    urls: [
      "https://www.icao.int/publications/Documents/9303_p3_cons_en.pdf",
      "https://www.icao.int/sites/default/files/publications/DocSeries/9303_p3_cons_en.pdf",
    ],
    terms:
      "ICAO copyright. Codes for nationality / issuing state that are not ISO 3166-1 (GBD/GBN/GBO/GBP/GBS, RKS, UNA/UNO/UNK, XXA/XXB/XXC/XXX, and the legacy single-letter D) are copied into ICAO_EXCEPTIONS only. Do not assume every MRZ alpha-3 equals ISO alpha-3.",
  },
} as const);

export type CountryKind = "state" | "icao_alias" | "special";

export type CountryEntry = {
  alpha3: string;
  alpha2: string;
  nameTr: string;
  nameEn: string;
  kind: CountryKind;
  hintTr?: string;
};

export const ICAO_COUNTRIES: readonly CountryEntry[] = Object.freeze([
  { alpha3: "ABW", alpha2: "AW", nameTr: "Aruba", nameEn: "Aruba", kind: "state" },
  { alpha3: "AFG", alpha2: "AF", nameTr: "Afganistan", nameEn: "Afghanistan", kind: "state" },
  { alpha3: "AGO", alpha2: "AO", nameTr: "Angola", nameEn: "Angola", kind: "state" },
  { alpha3: "AIA", alpha2: "AI", nameTr: "Anguilla", nameEn: "Anguilla", kind: "state" },
  { alpha3: "ALA", alpha2: "AX", nameTr: "Åland Adaları", nameEn: "Åland Islands", kind: "state" },
  { alpha3: "ALB", alpha2: "AL", nameTr: "Arnavutluk", nameEn: "Albania", kind: "state" },
  { alpha3: "AND", alpha2: "AD", nameTr: "Andorra", nameEn: "Andorra", kind: "state" },
  { alpha3: "ARE", alpha2: "AE", nameTr: "Birleşik Arap Emirlikleri", nameEn: "United Arab Emirates", kind: "state" },
  { alpha3: "ARG", alpha2: "AR", nameTr: "Arjantin", nameEn: "Argentina", kind: "state" },
  { alpha3: "ARM", alpha2: "AM", nameTr: "Ermenistan", nameEn: "Armenia", kind: "state" },
  { alpha3: "ASM", alpha2: "AS", nameTr: "Amerikan Samoası", nameEn: "American Samoa", kind: "state" },
  { alpha3: "ATA", alpha2: "AQ", nameTr: "Antarktika", nameEn: "Antarctica", kind: "state" },
  { alpha3: "ATF", alpha2: "TF", nameTr: "Fransız Güney Toprakları", nameEn: "French Southern Territories", kind: "state" },
  { alpha3: "ATG", alpha2: "AG", nameTr: "Antigua ve Barbuda", nameEn: "Antigua and Barbuda", kind: "state" },
  { alpha3: "AUS", alpha2: "AU", nameTr: "Avustralya", nameEn: "Australia", kind: "state" },
  { alpha3: "AUT", alpha2: "AT", nameTr: "Avusturya", nameEn: "Austria", kind: "state" },
  { alpha3: "AZE", alpha2: "AZ", nameTr: "Azerbaycan", nameEn: "Azerbaijan", kind: "state" },
  { alpha3: "BDI", alpha2: "BI", nameTr: "Burundi", nameEn: "Burundi", kind: "state" },
  { alpha3: "BEL", alpha2: "BE", nameTr: "Belçika", nameEn: "Belgium", kind: "state" },
  { alpha3: "BEN", alpha2: "BJ", nameTr: "Benin", nameEn: "Benin", kind: "state" },
  { alpha3: "BES", alpha2: "BQ", nameTr: "Karayip Hollandası", nameEn: "Bonaire, Sint Eustatius and Saba", kind: "state" },
  { alpha3: "BFA", alpha2: "BF", nameTr: "Burkina Faso", nameEn: "Burkina Faso", kind: "state" },
  { alpha3: "BGD", alpha2: "BD", nameTr: "Bangladeş", nameEn: "Bangladesh", kind: "state" },
  { alpha3: "BGR", alpha2: "BG", nameTr: "Bulgaristan", nameEn: "Bulgaria", kind: "state" },
  { alpha3: "BHR", alpha2: "BH", nameTr: "Bahreyn", nameEn: "Bahrain", kind: "state" },
  { alpha3: "BHS", alpha2: "BS", nameTr: "Bahamalar", nameEn: "Bahamas", kind: "state" },
  { alpha3: "BIH", alpha2: "BA", nameTr: "Bosna-Hersek", nameEn: "Bosnia and Herzegovina", kind: "state" },
  { alpha3: "BLM", alpha2: "BL", nameTr: "Saint Barthelemy", nameEn: "Saint Barthélemy", kind: "state" },
  { alpha3: "BLR", alpha2: "BY", nameTr: "Belarus", nameEn: "Belarus", kind: "state" },
  { alpha3: "BLZ", alpha2: "BZ", nameTr: "Belize", nameEn: "Belize", kind: "state" },
  { alpha3: "BMU", alpha2: "BM", nameTr: "Bermuda", nameEn: "Bermuda", kind: "state" },
  { alpha3: "BOL", alpha2: "BO", nameTr: "Bolivya", nameEn: "Bolivia, Plurinational State of", kind: "state" },
  { alpha3: "BRA", alpha2: "BR", nameTr: "Brezilya", nameEn: "Brazil", kind: "state" },
  { alpha3: "BRB", alpha2: "BB", nameTr: "Barbados", nameEn: "Barbados", kind: "state" },
  { alpha3: "BRN", alpha2: "BN", nameTr: "Brunei", nameEn: "Brunei Darussalam", kind: "state" },
  { alpha3: "BTN", alpha2: "BT", nameTr: "Butan", nameEn: "Bhutan", kind: "state" },
  { alpha3: "BVT", alpha2: "BV", nameTr: "Bouvet Adası", nameEn: "Bouvet Island", kind: "state" },
  { alpha3: "BWA", alpha2: "BW", nameTr: "Botsvana", nameEn: "Botswana", kind: "state" },
  { alpha3: "CAF", alpha2: "CF", nameTr: "Orta Afrika Cumhuriyeti", nameEn: "Central African Republic", kind: "state" },
  { alpha3: "CAN", alpha2: "CA", nameTr: "Kanada", nameEn: "Canada", kind: "state" },
  { alpha3: "CCK", alpha2: "CC", nameTr: "Cocos (Keeling) Adaları", nameEn: "Cocos (Keeling) Islands", kind: "state" },
  { alpha3: "CHE", alpha2: "CH", nameTr: "İsviçre", nameEn: "Switzerland", kind: "state" },
  { alpha3: "CHL", alpha2: "CL", nameTr: "Şili", nameEn: "Chile", kind: "state" },
  { alpha3: "CHN", alpha2: "CN", nameTr: "Çin", nameEn: "China", kind: "state" },
  { alpha3: "CIV", alpha2: "CI", nameTr: "Côte d’Ivoire", nameEn: "Côte d'Ivoire", kind: "state" },
  { alpha3: "CMR", alpha2: "CM", nameTr: "Kamerun", nameEn: "Cameroon", kind: "state" },
  { alpha3: "COD", alpha2: "CD", nameTr: "Kongo - Kinşasa", nameEn: "Congo, Democratic Republic of the", kind: "state" },
  { alpha3: "COG", alpha2: "CG", nameTr: "Kongo - Brazavil", nameEn: "Congo", kind: "state" },
  { alpha3: "COK", alpha2: "CK", nameTr: "Cook Adaları", nameEn: "Cook Islands", kind: "state" },
  { alpha3: "COL", alpha2: "CO", nameTr: "Kolombiya", nameEn: "Colombia", kind: "state" },
  { alpha3: "COM", alpha2: "KM", nameTr: "Komorlar", nameEn: "Comoros", kind: "state" },
  { alpha3: "CPV", alpha2: "CV", nameTr: "Cape Verde", nameEn: "Cabo Verde", kind: "state" },
  { alpha3: "CRI", alpha2: "CR", nameTr: "Kosta Rika", nameEn: "Costa Rica", kind: "state" },
  { alpha3: "CUB", alpha2: "CU", nameTr: "Küba", nameEn: "Cuba", kind: "state" },
  { alpha3: "CUW", alpha2: "CW", nameTr: "Curaçao", nameEn: "Curaçao", kind: "state" },
  { alpha3: "CXR", alpha2: "CX", nameTr: "Christmas Adası", nameEn: "Christmas Island", kind: "state" },
  { alpha3: "CYM", alpha2: "KY", nameTr: "Cayman Adaları", nameEn: "Cayman Islands", kind: "state" },
  { alpha3: "CYP", alpha2: "CY", nameTr: "Kıbrıs", nameEn: "Cyprus", kind: "state" },
  { alpha3: "CZE", alpha2: "CZ", nameTr: "Çekya", nameEn: "Czechia", kind: "state" },
  { alpha3: "DEU", alpha2: "DE", nameTr: "Almanya", nameEn: "Germany", kind: "state" },
  { alpha3: "DJI", alpha2: "DJ", nameTr: "Cibuti", nameEn: "Djibouti", kind: "state" },
  { alpha3: "DMA", alpha2: "DM", nameTr: "Dominika", nameEn: "Dominica", kind: "state" },
  { alpha3: "DNK", alpha2: "DK", nameTr: "Danimarka", nameEn: "Denmark", kind: "state" },
  { alpha3: "DOM", alpha2: "DO", nameTr: "Dominik Cumhuriyeti", nameEn: "Dominican Republic", kind: "state" },
  { alpha3: "DZA", alpha2: "DZ", nameTr: "Cezayir", nameEn: "Algeria", kind: "state" },
  { alpha3: "ECU", alpha2: "EC", nameTr: "Ekvador", nameEn: "Ecuador", kind: "state" },
  { alpha3: "EGY", alpha2: "EG", nameTr: "Mısır", nameEn: "Egypt", kind: "state" },
  { alpha3: "ERI", alpha2: "ER", nameTr: "Eritre", nameEn: "Eritrea", kind: "state" },
  { alpha3: "ESH", alpha2: "EH", nameTr: "Batı Sahra", nameEn: "Western Sahara", kind: "state" },
  { alpha3: "ESP", alpha2: "ES", nameTr: "İspanya", nameEn: "Spain", kind: "state" },
  { alpha3: "EST", alpha2: "EE", nameTr: "Estonya", nameEn: "Estonia", kind: "state" },
  { alpha3: "ETH", alpha2: "ET", nameTr: "Etiyopya", nameEn: "Ethiopia", kind: "state" },
  { alpha3: "FIN", alpha2: "FI", nameTr: "Finlandiya", nameEn: "Finland", kind: "state" },
  { alpha3: "FJI", alpha2: "FJ", nameTr: "Fiji", nameEn: "Fiji", kind: "state" },
  { alpha3: "FLK", alpha2: "FK", nameTr: "Falkland Adaları", nameEn: "Falkland Islands (Malvinas)", kind: "state" },
  { alpha3: "FRA", alpha2: "FR", nameTr: "Fransa", nameEn: "France", kind: "state" },
  { alpha3: "FRO", alpha2: "FO", nameTr: "Faroe Adaları", nameEn: "Faroe Islands", kind: "state" },
  { alpha3: "FSM", alpha2: "FM", nameTr: "Mikronezya", nameEn: "Micronesia, Federated States of", kind: "state" },
  { alpha3: "GAB", alpha2: "GA", nameTr: "Gabon", nameEn: "Gabon", kind: "state" },
  { alpha3: "GBR", alpha2: "GB", nameTr: "Birleşik Krallık", nameEn: "United Kingdom of Great Britain and Northern Ireland", kind: "state" },
  { alpha3: "GEO", alpha2: "GE", nameTr: "Gürcistan", nameEn: "Georgia", kind: "state" },
  { alpha3: "GGY", alpha2: "GG", nameTr: "Guernsey", nameEn: "Guernsey", kind: "state" },
  { alpha3: "GHA", alpha2: "GH", nameTr: "Gana", nameEn: "Ghana", kind: "state" },
  { alpha3: "GIB", alpha2: "GI", nameTr: "Cebelitarık", nameEn: "Gibraltar", kind: "state" },
  { alpha3: "GIN", alpha2: "GN", nameTr: "Gine", nameEn: "Guinea", kind: "state" },
  { alpha3: "GLP", alpha2: "GP", nameTr: "Guadeloupe", nameEn: "Guadeloupe", kind: "state" },
  { alpha3: "GMB", alpha2: "GM", nameTr: "Gambiya", nameEn: "Gambia", kind: "state" },
  { alpha3: "GNB", alpha2: "GW", nameTr: "Gine-Bissau", nameEn: "Guinea-Bissau", kind: "state" },
  { alpha3: "GNQ", alpha2: "GQ", nameTr: "Ekvator Ginesi", nameEn: "Equatorial Guinea", kind: "state" },
  { alpha3: "GRC", alpha2: "GR", nameTr: "Yunanistan", nameEn: "Greece", kind: "state" },
  { alpha3: "GRD", alpha2: "GD", nameTr: "Grenada", nameEn: "Grenada", kind: "state" },
  { alpha3: "GRL", alpha2: "GL", nameTr: "Grönland", nameEn: "Greenland", kind: "state" },
  { alpha3: "GTM", alpha2: "GT", nameTr: "Guatemala", nameEn: "Guatemala", kind: "state" },
  { alpha3: "GUF", alpha2: "GF", nameTr: "Fransız Guyanası", nameEn: "French Guiana", kind: "state" },
  { alpha3: "GUM", alpha2: "GU", nameTr: "Guam", nameEn: "Guam", kind: "state" },
  { alpha3: "GUY", alpha2: "GY", nameTr: "Guyana", nameEn: "Guyana", kind: "state" },
  { alpha3: "HKG", alpha2: "HK", nameTr: "Çin Hong Kong ÖİB", nameEn: "Hong Kong", kind: "state" },
  { alpha3: "HMD", alpha2: "HM", nameTr: "Heard Adası ve McDonald Adaları", nameEn: "Heard Island and McDonald Islands", kind: "state" },
  { alpha3: "HND", alpha2: "HN", nameTr: "Honduras", nameEn: "Honduras", kind: "state" },
  { alpha3: "HRV", alpha2: "HR", nameTr: "Hırvatistan", nameEn: "Croatia", kind: "state" },
  { alpha3: "HTI", alpha2: "HT", nameTr: "Haiti", nameEn: "Haiti", kind: "state" },
  { alpha3: "HUN", alpha2: "HU", nameTr: "Macaristan", nameEn: "Hungary", kind: "state" },
  { alpha3: "IDN", alpha2: "ID", nameTr: "Endonezya", nameEn: "Indonesia", kind: "state" },
  { alpha3: "IMN", alpha2: "IM", nameTr: "Man Adası", nameEn: "Isle of Man", kind: "state" },
  { alpha3: "IND", alpha2: "IN", nameTr: "Hindistan", nameEn: "India", kind: "state" },
  { alpha3: "IOT", alpha2: "IO", nameTr: "Britanya Hint Okyanusu Toprakları", nameEn: "British Indian Ocean Territory", kind: "state" },
  { alpha3: "IRL", alpha2: "IE", nameTr: "İrlanda", nameEn: "Ireland", kind: "state" },
  { alpha3: "IRN", alpha2: "IR", nameTr: "İran", nameEn: "Iran, Islamic Republic of", kind: "state" },
  { alpha3: "IRQ", alpha2: "IQ", nameTr: "Irak", nameEn: "Iraq", kind: "state" },
  { alpha3: "ISL", alpha2: "IS", nameTr: "İzlanda", nameEn: "Iceland", kind: "state" },
  { alpha3: "ISR", alpha2: "IL", nameTr: "İsrail", nameEn: "Israel", kind: "state" },
  { alpha3: "ITA", alpha2: "IT", nameTr: "İtalya", nameEn: "Italy", kind: "state" },
  { alpha3: "JAM", alpha2: "JM", nameTr: "Jamaika", nameEn: "Jamaica", kind: "state" },
  { alpha3: "JEY", alpha2: "JE", nameTr: "Jersey", nameEn: "Jersey", kind: "state" },
  { alpha3: "JOR", alpha2: "JO", nameTr: "Ürdün", nameEn: "Jordan", kind: "state" },
  { alpha3: "JPN", alpha2: "JP", nameTr: "Japonya", nameEn: "Japan", kind: "state" },
  { alpha3: "KAZ", alpha2: "KZ", nameTr: "Kazakistan", nameEn: "Kazakhstan", kind: "state" },
  { alpha3: "KEN", alpha2: "KE", nameTr: "Kenya", nameEn: "Kenya", kind: "state" },
  { alpha3: "KGZ", alpha2: "KG", nameTr: "Kırgızistan", nameEn: "Kyrgyzstan", kind: "state" },
  { alpha3: "KHM", alpha2: "KH", nameTr: "Kamboçya", nameEn: "Cambodia", kind: "state" },
  { alpha3: "KIR", alpha2: "KI", nameTr: "Kiribati", nameEn: "Kiribati", kind: "state" },
  { alpha3: "KNA", alpha2: "KN", nameTr: "Saint Kitts ve Nevis", nameEn: "Saint Kitts and Nevis", kind: "state" },
  { alpha3: "KOR", alpha2: "KR", nameTr: "Güney Kore", nameEn: "Korea, Republic of", kind: "state" },
  { alpha3: "KWT", alpha2: "KW", nameTr: "Kuveyt", nameEn: "Kuwait", kind: "state" },
  { alpha3: "LAO", alpha2: "LA", nameTr: "Laos", nameEn: "Lao People's Democratic Republic", kind: "state" },
  { alpha3: "LBN", alpha2: "LB", nameTr: "Lübnan", nameEn: "Lebanon", kind: "state" },
  { alpha3: "LBR", alpha2: "LR", nameTr: "Liberya", nameEn: "Liberia", kind: "state" },
  { alpha3: "LBY", alpha2: "LY", nameTr: "Libya", nameEn: "Libya", kind: "state" },
  { alpha3: "LCA", alpha2: "LC", nameTr: "Saint Lucia", nameEn: "Saint Lucia", kind: "state" },
  { alpha3: "LIE", alpha2: "LI", nameTr: "Liechtenstein", nameEn: "Liechtenstein", kind: "state" },
  { alpha3: "LKA", alpha2: "LK", nameTr: "Sri Lanka", nameEn: "Sri Lanka", kind: "state" },
  { alpha3: "LSO", alpha2: "LS", nameTr: "Lesotho", nameEn: "Lesotho", kind: "state" },
  { alpha3: "LTU", alpha2: "LT", nameTr: "Litvanya", nameEn: "Lithuania", kind: "state" },
  { alpha3: "LUX", alpha2: "LU", nameTr: "Lüksemburg", nameEn: "Luxembourg", kind: "state" },
  { alpha3: "LVA", alpha2: "LV", nameTr: "Letonya", nameEn: "Latvia", kind: "state" },
  { alpha3: "MAC", alpha2: "MO", nameTr: "Çin Makao ÖİB", nameEn: "Macao", kind: "state" },
  { alpha3: "MAF", alpha2: "MF", nameTr: "Saint Martin", nameEn: "Saint Martin (French part)", kind: "state" },
  { alpha3: "MAR", alpha2: "MA", nameTr: "Fas", nameEn: "Morocco", kind: "state" },
  { alpha3: "MCO", alpha2: "MC", nameTr: "Monako", nameEn: "Monaco", kind: "state" },
  { alpha3: "MDA", alpha2: "MD", nameTr: "Moldova", nameEn: "Moldova, Republic of", kind: "state" },
  { alpha3: "MDG", alpha2: "MG", nameTr: "Madagaskar", nameEn: "Madagascar", kind: "state" },
  { alpha3: "MDV", alpha2: "MV", nameTr: "Maldivler", nameEn: "Maldives", kind: "state" },
  { alpha3: "MEX", alpha2: "MX", nameTr: "Meksika", nameEn: "Mexico", kind: "state" },
  { alpha3: "MHL", alpha2: "MH", nameTr: "Marshall Adaları", nameEn: "Marshall Islands", kind: "state" },
  { alpha3: "MKD", alpha2: "MK", nameTr: "Kuzey Makedonya", nameEn: "North Macedonia", kind: "state" },
  { alpha3: "MLI", alpha2: "ML", nameTr: "Mali", nameEn: "Mali", kind: "state" },
  { alpha3: "MLT", alpha2: "MT", nameTr: "Malta", nameEn: "Malta", kind: "state" },
  { alpha3: "MMR", alpha2: "MM", nameTr: "Myanmar (Burma)", nameEn: "Myanmar", kind: "state" },
  { alpha3: "MNE", alpha2: "ME", nameTr: "Karadağ", nameEn: "Montenegro", kind: "state" },
  { alpha3: "MNG", alpha2: "MN", nameTr: "Moğolistan", nameEn: "Mongolia", kind: "state" },
  { alpha3: "MNP", alpha2: "MP", nameTr: "Kuzey Mariana Adaları", nameEn: "Northern Mariana Islands", kind: "state" },
  { alpha3: "MOZ", alpha2: "MZ", nameTr: "Mozambik", nameEn: "Mozambique", kind: "state" },
  { alpha3: "MRT", alpha2: "MR", nameTr: "Moritanya", nameEn: "Mauritania", kind: "state" },
  { alpha3: "MSR", alpha2: "MS", nameTr: "Montserrat", nameEn: "Montserrat", kind: "state" },
  { alpha3: "MTQ", alpha2: "MQ", nameTr: "Martinik", nameEn: "Martinique", kind: "state" },
  { alpha3: "MUS", alpha2: "MU", nameTr: "Mauritius", nameEn: "Mauritius", kind: "state" },
  { alpha3: "MWI", alpha2: "MW", nameTr: "Malavi", nameEn: "Malawi", kind: "state" },
  { alpha3: "MYS", alpha2: "MY", nameTr: "Malezya", nameEn: "Malaysia", kind: "state" },
  { alpha3: "MYT", alpha2: "YT", nameTr: "Mayotte", nameEn: "Mayotte", kind: "state" },
  { alpha3: "NAM", alpha2: "NA", nameTr: "Namibya", nameEn: "Namibia", kind: "state" },
  { alpha3: "NCL", alpha2: "NC", nameTr: "Yeni Kaledonya", nameEn: "New Caledonia", kind: "state" },
  { alpha3: "NER", alpha2: "NE", nameTr: "Nijer", nameEn: "Niger", kind: "state" },
  { alpha3: "NFK", alpha2: "NF", nameTr: "Norfolk Adası", nameEn: "Norfolk Island", kind: "state" },
  { alpha3: "NGA", alpha2: "NG", nameTr: "Nijerya", nameEn: "Nigeria", kind: "state" },
  { alpha3: "NIC", alpha2: "NI", nameTr: "Nikaragua", nameEn: "Nicaragua", kind: "state" },
  { alpha3: "NIU", alpha2: "NU", nameTr: "Niue", nameEn: "Niue", kind: "state" },
  { alpha3: "NLD", alpha2: "NL", nameTr: "Hollanda", nameEn: "Netherlands, Kingdom of the", kind: "state" },
  { alpha3: "NOR", alpha2: "NO", nameTr: "Norveç", nameEn: "Norway", kind: "state" },
  { alpha3: "NPL", alpha2: "NP", nameTr: "Nepal", nameEn: "Nepal", kind: "state" },
  { alpha3: "NRU", alpha2: "NR", nameTr: "Nauru", nameEn: "Nauru", kind: "state" },
  { alpha3: "NZL", alpha2: "NZ", nameTr: "Yeni Zelanda", nameEn: "New Zealand", kind: "state" },
  { alpha3: "OMN", alpha2: "OM", nameTr: "Umman", nameEn: "Oman", kind: "state" },
  { alpha3: "PAK", alpha2: "PK", nameTr: "Pakistan", nameEn: "Pakistan", kind: "state" },
  { alpha3: "PAN", alpha2: "PA", nameTr: "Panama", nameEn: "Panama", kind: "state" },
  { alpha3: "PCN", alpha2: "PN", nameTr: "Pitcairn Adaları", nameEn: "Pitcairn", kind: "state" },
  { alpha3: "PER", alpha2: "PE", nameTr: "Peru", nameEn: "Peru", kind: "state" },
  { alpha3: "PHL", alpha2: "PH", nameTr: "Filipinler", nameEn: "Philippines", kind: "state" },
  { alpha3: "PLW", alpha2: "PW", nameTr: "Palau", nameEn: "Palau", kind: "state" },
  { alpha3: "PNG", alpha2: "PG", nameTr: "Papua Yeni Gine", nameEn: "Papua New Guinea", kind: "state" },
  { alpha3: "POL", alpha2: "PL", nameTr: "Polonya", nameEn: "Poland", kind: "state" },
  { alpha3: "PRI", alpha2: "PR", nameTr: "Porto Riko", nameEn: "Puerto Rico", kind: "state" },
  { alpha3: "PRK", alpha2: "KP", nameTr: "Kuzey Kore", nameEn: "Korea, Democratic People's Republic of", kind: "state" },
  { alpha3: "PRT", alpha2: "PT", nameTr: "Portekiz", nameEn: "Portugal", kind: "state" },
  { alpha3: "PRY", alpha2: "PY", nameTr: "Paraguay", nameEn: "Paraguay", kind: "state" },
  { alpha3: "PSE", alpha2: "PS", nameTr: "Filistin Bölgeleri", nameEn: "Palestine, State of", kind: "state" },
  { alpha3: "PYF", alpha2: "PF", nameTr: "Fransız Polinezyası", nameEn: "French Polynesia", kind: "state" },
  { alpha3: "QAT", alpha2: "QA", nameTr: "Katar", nameEn: "Qatar", kind: "state" },
  { alpha3: "REU", alpha2: "RE", nameTr: "Reunion", nameEn: "Réunion", kind: "state" },
  { alpha3: "ROU", alpha2: "RO", nameTr: "Romanya", nameEn: "Romania", kind: "state" },
  { alpha3: "RUS", alpha2: "RU", nameTr: "Rusya", nameEn: "Russian Federation", kind: "state" },
  { alpha3: "RWA", alpha2: "RW", nameTr: "Ruanda", nameEn: "Rwanda", kind: "state" },
  { alpha3: "SAU", alpha2: "SA", nameTr: "Suudi Arabistan", nameEn: "Saudi Arabia", kind: "state" },
  { alpha3: "SDN", alpha2: "SD", nameTr: "Sudan", nameEn: "Sudan", kind: "state" },
  { alpha3: "SEN", alpha2: "SN", nameTr: "Senegal", nameEn: "Senegal", kind: "state" },
  { alpha3: "SGP", alpha2: "SG", nameTr: "Singapur", nameEn: "Singapore", kind: "state" },
  { alpha3: "SGS", alpha2: "GS", nameTr: "Güney Georgia ve Güney Sandwich Adaları", nameEn: "South Georgia and the South Sandwich Islands", kind: "state" },
  { alpha3: "SHN", alpha2: "SH", nameTr: "Saint Helena", nameEn: "Saint Helena, Ascension and Tristan da Cunha", kind: "state" },
  { alpha3: "SJM", alpha2: "SJ", nameTr: "Svalbard ve Jan Mayen", nameEn: "Svalbard and Jan Mayen", kind: "state" },
  { alpha3: "SLB", alpha2: "SB", nameTr: "Solomon Adaları", nameEn: "Solomon Islands", kind: "state" },
  { alpha3: "SLE", alpha2: "SL", nameTr: "Sierra Leone", nameEn: "Sierra Leone", kind: "state" },
  { alpha3: "SLV", alpha2: "SV", nameTr: "El Salvador", nameEn: "El Salvador", kind: "state" },
  { alpha3: "SMR", alpha2: "SM", nameTr: "San Marino", nameEn: "San Marino", kind: "state" },
  { alpha3: "SOM", alpha2: "SO", nameTr: "Somali", nameEn: "Somalia", kind: "state" },
  { alpha3: "SPM", alpha2: "PM", nameTr: "Saint Pierre ve Miquelon", nameEn: "Saint Pierre and Miquelon", kind: "state" },
  { alpha3: "SRB", alpha2: "RS", nameTr: "Sırbistan", nameEn: "Serbia", kind: "state" },
  { alpha3: "SSD", alpha2: "SS", nameTr: "Güney Sudan", nameEn: "South Sudan", kind: "state" },
  { alpha3: "STP", alpha2: "ST", nameTr: "Sao Tome ve Principe", nameEn: "Sao Tome and Principe", kind: "state" },
  { alpha3: "SUR", alpha2: "SR", nameTr: "Surinam", nameEn: "Suriname", kind: "state" },
  { alpha3: "SVK", alpha2: "SK", nameTr: "Slovakya", nameEn: "Slovakia", kind: "state" },
  { alpha3: "SVN", alpha2: "SI", nameTr: "Slovenya", nameEn: "Slovenia", kind: "state" },
  { alpha3: "SWE", alpha2: "SE", nameTr: "İsveç", nameEn: "Sweden", kind: "state" },
  { alpha3: "SWZ", alpha2: "SZ", nameTr: "Esvatini", nameEn: "Eswatini", kind: "state" },
  { alpha3: "SXM", alpha2: "SX", nameTr: "Sint Maarten", nameEn: "Sint Maarten (Dutch part)", kind: "state" },
  { alpha3: "SYC", alpha2: "SC", nameTr: "Seyşeller", nameEn: "Seychelles", kind: "state" },
  { alpha3: "SYR", alpha2: "SY", nameTr: "Suriye", nameEn: "Syrian Arab Republic", kind: "state" },
  { alpha3: "TCA", alpha2: "TC", nameTr: "Turks ve Caicos Adaları", nameEn: "Turks and Caicos Islands", kind: "state" },
  { alpha3: "TCD", alpha2: "TD", nameTr: "Çad", nameEn: "Chad", kind: "state" },
  { alpha3: "TGO", alpha2: "TG", nameTr: "Togo", nameEn: "Togo", kind: "state" },
  { alpha3: "THA", alpha2: "TH", nameTr: "Tayland", nameEn: "Thailand", kind: "state" },
  { alpha3: "TJK", alpha2: "TJ", nameTr: "Tacikistan", nameEn: "Tajikistan", kind: "state" },
  { alpha3: "TKL", alpha2: "TK", nameTr: "Tokelau", nameEn: "Tokelau", kind: "state" },
  { alpha3: "TKM", alpha2: "TM", nameTr: "Türkmenistan", nameEn: "Turkmenistan", kind: "state" },
  { alpha3: "TLS", alpha2: "TL", nameTr: "Timor-Leste", nameEn: "Timor-Leste", kind: "state" },
  { alpha3: "TON", alpha2: "TO", nameTr: "Tonga", nameEn: "Tonga", kind: "state" },
  { alpha3: "TTO", alpha2: "TT", nameTr: "Trinidad ve Tobago", nameEn: "Trinidad and Tobago", kind: "state" },
  { alpha3: "TUN", alpha2: "TN", nameTr: "Tunus", nameEn: "Tunisia", kind: "state" },
  { alpha3: "TUR", alpha2: "TR", nameTr: "Türkiye", nameEn: "Türkiye", kind: "state" },
  { alpha3: "TUV", alpha2: "TV", nameTr: "Tuvalu", nameEn: "Tuvalu", kind: "state" },
  { alpha3: "TWN", alpha2: "TW", nameTr: "Tayvan", nameEn: "Taiwan, Province of China", kind: "state" },
  { alpha3: "TZA", alpha2: "TZ", nameTr: "Tanzanya", nameEn: "Tanzania, United Republic of", kind: "state" },
  { alpha3: "UGA", alpha2: "UG", nameTr: "Uganda", nameEn: "Uganda", kind: "state" },
  { alpha3: "UKR", alpha2: "UA", nameTr: "Ukrayna", nameEn: "Ukraine", kind: "state" },
  { alpha3: "UMI", alpha2: "UM", nameTr: "ABD Küçük Harici Adaları", nameEn: "United States Minor Outlying Islands", kind: "state" },
  { alpha3: "URY", alpha2: "UY", nameTr: "Uruguay", nameEn: "Uruguay", kind: "state" },
  { alpha3: "USA", alpha2: "US", nameTr: "Amerika Birleşik Devletleri", nameEn: "United States of America", kind: "state" },
  { alpha3: "UZB", alpha2: "UZ", nameTr: "Özbekistan", nameEn: "Uzbekistan", kind: "state" },
  { alpha3: "VAT", alpha2: "VA", nameTr: "Vatikan", nameEn: "Holy See", kind: "state" },
  { alpha3: "VCT", alpha2: "VC", nameTr: "Saint Vincent ve Grenadinler", nameEn: "Saint Vincent and the Grenadines", kind: "state" },
  { alpha3: "VEN", alpha2: "VE", nameTr: "Venezuela", nameEn: "Venezuela, Bolivarian Republic of", kind: "state" },
  { alpha3: "VGB", alpha2: "VG", nameTr: "Britanya Virjin Adaları", nameEn: "Virgin Islands (British)", kind: "state" },
  { alpha3: "VIR", alpha2: "VI", nameTr: "ABD Virjin Adaları", nameEn: "Virgin Islands (U.S.)", kind: "state" },
  { alpha3: "VNM", alpha2: "VN", nameTr: "Vietnam", nameEn: "Viet Nam", kind: "state" },
  { alpha3: "VUT", alpha2: "VU", nameTr: "Vanuatu", nameEn: "Vanuatu", kind: "state" },
  { alpha3: "WLF", alpha2: "WF", nameTr: "Wallis ve Futuna", nameEn: "Wallis and Futuna", kind: "state" },
  { alpha3: "WSM", alpha2: "WS", nameTr: "Samoa", nameEn: "Samoa", kind: "state" },
  { alpha3: "YEM", alpha2: "YE", nameTr: "Yemen", nameEn: "Yemen", kind: "state" },
  { alpha3: "ZAF", alpha2: "ZA", nameTr: "Güney Afrika", nameEn: "South Africa", kind: "state" },
  { alpha3: "ZMB", alpha2: "ZM", nameTr: "Zambiya", nameEn: "Zambia", kind: "state" },
  { alpha3: "ZWE", alpha2: "ZW", nameTr: "Zimbabve", nameEn: "Zimbabwe", kind: "state" },
  { alpha3: "D", alpha2: "DE", nameTr: "Almanya (ICAO D)", nameEn: "Germany (legacy ICAO D)", kind: "icao_alias", hintTr: "ICAO 9303 eski Almanya kodu; ISO alpha-3 DEU" },
  { alpha3: "GBD", alpha2: "GB", nameTr: "Britanya — Denizaşırı Toprak Vatandaşı", nameEn: "British Overseas Territories Citizen", kind: "icao_alias" },
  { alpha3: "GBN", alpha2: "GB", nameTr: "Britanya — Ulusal (Denizaşırı)", nameEn: "British National (Overseas)", kind: "icao_alias" },
  { alpha3: "GBO", alpha2: "GB", nameTr: "Britanya — Denizaşırı Vatandaş", nameEn: "British Overseas Citizen", kind: "icao_alias" },
  { alpha3: "GBP", alpha2: "GB", nameTr: "Britanya — Korunan Kişi", nameEn: "British Protected Person", kind: "icao_alias" },
  { alpha3: "GBS", alpha2: "GB", nameTr: "Britanya — Tebaa", nameEn: "British Subject", kind: "icao_alias" },
  { alpha3: "RKS", alpha2: "XK", nameTr: "Kosova (RKS)", nameEn: "Kosovo (RKS)", kind: "icao_alias", hintTr: "ICAO 9303 Kosovo üç harf kodu; ISO 3166-1'de yok" },
  { alpha3: "XKX", alpha2: "XK", nameTr: "Kosova (XKX)", nameEn: "Kosovo (XKX)", kind: "icao_alias", hintTr: "Kullanıcı atamalı ISO benzeri kod; resmi ISO 3166-1 değil" },
  { alpha3: "XXA", alpha2: "", nameTr: "Vatansız (1954 Sözleşmesi)", nameEn: "Stateless person (1954 Convention)", kind: "special", hintTr: "ISO karşılığı yok; ülke kodu yazılmaz — belgedeki durumu teyit edin" },
  { alpha3: "XXB", alpha2: "", nameTr: "Mülteci (1951 Sözleşmesi)", nameEn: "Refugee (1951 Convention)", kind: "special", hintTr: "ISO karşılığı yok; ülke kodu yazılmaz — belgedeki durumu teyit edin" },
  { alpha3: "XXC", alpha2: "", nameTr: "Mülteci (diğer)", nameEn: "Refugee (other)", kind: "special", hintTr: "ISO karşılığı yok; ülke kodu yazılmaz — belgedeki durumu teyit edin" },
  { alpha3: "XXX", alpha2: "", nameTr: "Uyruk belirtilmemiş", nameEn: "Unspecified nationality", kind: "special", hintTr: "ISO karşılığı yok; belgedeki doğru bilgiyi teyit edin" },
  { alpha3: "UNO", alpha2: "", nameTr: "Birleşmiş Milletler (laissez-passer)", nameEn: "United Nations Organization", kind: "special", hintTr: "Kuruluş belgesi; rastgele ülkeye çevrilmez" },
  { alpha3: "UNA", alpha2: "", nameTr: "BM uzman kuruluşu", nameEn: "UN specialized agency", kind: "special", hintTr: "Kuruluş belgesi; rastgele ülkeye çevrilmez" },
  { alpha3: "UNK", alpha2: "", nameTr: "UNMIK Kosova sakini", nameEn: "UNMIK Kosovo resident", kind: "special", hintTr: "Kosova için XK seçilebilir; otomatik dönüşüm yok" },
  { alpha3: "UTO", alpha2: "", nameTr: "Ütopya (ICAO örnek belge)", nameEn: "Utopia (ICAO specimen)", kind: "special", hintTr: "Örnek/test belgesi — gerçek yolcu değil; UTO→TR sayılmaz" },
  { alpha3: "EUE", alpha2: "", nameTr: "Avrupa Birliği (laissez-passer)", nameEn: "European Union", kind: "special", hintTr: "ISO 3166-1 ülkesi değil" },
  { alpha3: "XOM", alpha2: "", nameTr: "Malta Egemen Askeri Tarikatı", nameEn: "Sovereign Military Order of Malta", kind: "special", hintTr: "ISO karşılığı yok" },
  { alpha3: "XPO", alpha2: "", nameTr: "Interpol", nameEn: "Interpol", kind: "special", hintTr: "ISO karşılığı yok" },
  { alpha3: "XCC", alpha2: "", nameTr: "Karayip Topluluğu (CARICOM)", nameEn: "Caribbean Community", kind: "special" },
  { alpha3: "XEC", alpha2: "", nameTr: "ECOWAS", nameEn: "Economic Community of West African States", kind: "special" },
  { alpha3: "XCO", alpha2: "", nameTr: "COMESA", nameEn: "Common Market for Eastern and Southern Africa", kind: "special" },
  { alpha3: "XIM", alpha2: "", nameTr: "Afreximbank", nameEn: "African Export-Import Bank", kind: "special" },
]);

/** ISO 3166-1 alpha-3 → alpha-2 plus ICAO aliases that have an exportable code. */
export const ICAO3_TO_ISO2: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    ICAO_COUNTRIES.filter((entry) => entry.alpha2).map((entry) => [entry.alpha3, entry.alpha2]),
  ),
);

/** ICAO 9303 codes that are not ISO 3166-1 alpha-3 (or not a 1:1 state). */
export const ICAO_EXCEPTIONS: readonly CountryEntry[] = Object.freeze(
  ICAO_COUNTRIES.filter((entry) => entry.kind !== "state"),
);

const BY_ALPHA3 = new Map(ICAO_COUNTRIES.map((entry) => [entry.alpha3, entry]));
const ISO2_CODES = new Set(
  ICAO_COUNTRIES.filter((entry) => entry.kind === "state" || entry.alpha2 === "XK").map((entry) => entry.alpha2)
    .filter(Boolean),
);
/** ICAO Doc 9303 two-letter exception: Kosovo KS (not ISO 3166-1). */
const ICAO_ALPHA2_EXCEPTIONS: Readonly<Record<string, string>> = Object.freeze({ KS: "XK" });

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("tr-TR");
}

export function countryEntry(code: string): CountryEntry | null {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return null;
  return BY_ALPHA3.get(normalized) ?? null;
}

export function isSpecialNationality(code: string): boolean {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return false;
  const entry = BY_ALPHA3.get(normalized);
  if (entry) return entry.kind === "special";
  return !ISO2_CODES.has(normalized) && !ICAO3_TO_ISO2[normalized] && !ICAO_ALPHA2_EXCEPTIONS[normalized];
}

/**
 * Map an MRZ / operator country value to ISO 3166-1 alpha-2.
 * Unknown, specimen (UTO) and special codes return "".
 * Accepts ISO-2 only when that code is in the local table (or ICAO KS→XK).
 */
export function icaoCountryToIso2(value: string): string {
  const code = value.trim().toUpperCase();
  if (!code) return "";
  if (/^[A-Z]{2}$/.test(code)) {
    if (ICAO_ALPHA2_EXCEPTIONS[code]) return ICAO_ALPHA2_EXCEPTIONS[code];
    return ISO2_CODES.has(code) ? code : "";
  }
  return ICAO3_TO_ISO2[code] ?? "";
}

export function searchCountries(query: string, limit = 12): CountryEntry[] {
  const needle = fold(query.trim());
  if (!needle) {
    return ICAO_COUNTRIES.filter((entry) => entry.kind === "state").slice(0, limit);
  }
  const scored = ICAO_COUNTRIES.map((entry) => {
    const alpha3 = fold(entry.alpha3);
    const alpha2 = fold(entry.alpha2);
    const nameTr = fold(entry.nameTr);
    const nameEn = fold(entry.nameEn);
    let score = -1;
    if (alpha3 === needle || alpha2 === needle) score = 100;
    else if (alpha3.startsWith(needle) || alpha2.startsWith(needle)) score = 90;
    else if (nameTr.startsWith(needle) || nameEn.startsWith(needle)) score = 80;
    else if (nameTr.includes(needle) || nameEn.includes(needle)) score = 60;
    if (score < 0) return null;
    if (entry.kind === "special") score -= 15;
    if (entry.kind === "icao_alias") score -= 5;
    return { entry, score, shortestName: Math.min(nameTr.length, nameEn.length) };
  }).filter((row): row is { entry: CountryEntry; score: number; shortestName: number } => row !== null);
  scored.sort((left, right) => (
    right.score - left.score
    || left.shortestName - right.shortestName
    || left.entry.nameTr.localeCompare(right.entry.nameTr, "tr")
  ));
  return scored.slice(0, limit).map((row) => row.entry);
}
