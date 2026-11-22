/**
 * Countries the centre can be configured for. Choosing a country pre-fills the currency, decimal places,
 * time zone, phone prefix and mobile-money networks — every one of these can still be changed in Settings.
 *
 * Decimal places follow ISO 4217 (e.g. CFA francs have none). Mobile-money networks are common defaults
 * only; edit the list in Settings to match what your centre accepts.
 */
export interface Country {
  code: string;
  name: string;
  currency: string;
  minorUnits: number;
  dialCode: string;
  timezone: string;
  mobileMoney: string[];
}

const C = (code: string, name: string, currency: string, minorUnits: number, dialCode: string, timezone: string, mobileMoney: string[] = []): Country => ({
  code,
  name,
  currency,
  minorUnits,
  dialCode,
  timezone,
  mobileMoney,
});

export const COUNTRIES: Country[] = [
  C('DZ', 'Algeria', 'DZD', 2, '+213', 'Africa/Algiers'),
  C('AO', 'Angola', 'AOA', 2, '+244', 'Africa/Luanda', ['Unitel Money', 'Multicaixa Express']),
  C('BJ', 'Benin', 'XOF', 0, '+229', 'Africa/Porto-Novo', ['MTN MoMo', 'Moov Money', 'Celtiis Cash']),
  C('BW', 'Botswana', 'BWP', 2, '+267', 'Africa/Gaborone', ['Orange Money', 'MyZaka', 'Smega']),
  C('BF', 'Burkina Faso', 'XOF', 0, '+226', 'Africa/Ouagadougou', ['Orange Money', 'Moov Money']),
  C('BI', 'Burundi', 'BIF', 0, '+257', 'Africa/Bujumbura', ['Lumicash', 'Ecocash']),
  C('CV', 'Cabo Verde', 'CVE', 2, '+238', 'Atlantic/Cape_Verde'),
  C('CM', 'Cameroon', 'XAF', 0, '+237', 'Africa/Douala', ['MTN MoMo', 'Orange Money']),
  C('CF', 'Central African Republic', 'XAF', 0, '+236', 'Africa/Bangui', ['Orange Money', 'Telecel Cash']),
  C('TD', 'Chad', 'XAF', 0, '+235', 'Africa/Ndjamena', ['Airtel Money', 'Moov Money']),
  C('KM', 'Comoros', 'KMF', 0, '+269', 'Indian/Comoro', ['Huri Money', 'MVola']),
  C('CD', 'Congo (DRC)', 'CDF', 2, '+243', 'Africa/Kinshasa', ['M-Pesa', 'Airtel Money', 'Orange Money', 'Afrimoney']),
  C('CG', 'Congo (Republic)', 'XAF', 0, '+242', 'Africa/Brazzaville', ['MTN MoMo', 'Airtel Money']),
  C('CI', "Côte d'Ivoire", 'XOF', 0, '+225', 'Africa/Abidjan', ['Orange Money', 'MTN MoMo', 'Moov Money', 'Wave']),
  C('DJ', 'Djibouti', 'DJF', 0, '+253', 'Africa/Djibouti', ['D-Money', 'Waafi']),
  C('EG', 'Egypt', 'EGP', 2, '+20', 'Africa/Cairo', ['Vodafone Cash', 'Orange Cash', 'Etisalat Cash', 'InstaPay']),
  C('GQ', 'Equatorial Guinea', 'XAF', 0, '+240', 'Africa/Malabo'),
  C('ER', 'Eritrea', 'ERN', 2, '+291', 'Africa/Asmara'),
  C('SZ', 'Eswatini', 'SZL', 2, '+268', 'Africa/Mbabane', ['MTN MoMo', 'e-Mali']),
  C('ET', 'Ethiopia', 'ETB', 2, '+251', 'Africa/Addis_Ababa', ['telebirr', 'M-Pesa', 'CBE Birr']),
  C('GA', 'Gabon', 'XAF', 0, '+241', 'Africa/Libreville', ['Airtel Money', 'Moov Money']),
  C('GM', 'Gambia', 'GMD', 2, '+220', 'Africa/Banjul', ['Wave', 'Afrimoney', 'QMoney']),
  C('GH', 'Ghana', 'GHS', 2, '+233', 'Africa/Accra', ['MTN MoMo', 'Telecel Cash', 'AT Money']),
  C('GN', 'Guinea', 'GNF', 0, '+224', 'Africa/Conakry', ['Orange Money', 'MTN MoMo']),
  C('GW', 'Guinea-Bissau', 'XOF', 0, '+245', 'Africa/Bissau', ['Orange Money', 'MTN MoMo']),
  C('KE', 'Kenya', 'KES', 2, '+254', 'Africa/Nairobi', ['M-Pesa', 'Airtel Money', 'T-Kash']),
  C('LS', 'Lesotho', 'LSL', 2, '+266', 'Africa/Maseru', ['M-Pesa', 'EcoCash']),
  C('LR', 'Liberia', 'LRD', 2, '+231', 'Africa/Monrovia', ['Orange Money', 'Lonestar MoMo']),
  C('LY', 'Libya', 'LYD', 3, '+218', 'Africa/Tripoli'),
  C('MG', 'Madagascar', 'MGA', 2, '+261', 'Indian/Antananarivo', ['MVola', 'Orange Money', 'Airtel Money']),
  C('MW', 'Malawi', 'MWK', 2, '+265', 'Africa/Blantyre', ['Airtel Money', 'TNM Mpamba']),
  C('ML', 'Mali', 'XOF', 0, '+223', 'Africa/Bamako', ['Orange Money', 'Moov Money', 'Wave']),
  C('MR', 'Mauritania', 'MRU', 2, '+222', 'Africa/Nouakchott', ['Bankily', 'Masrvi']),
  C('MU', 'Mauritius', 'MUR', 2, '+230', 'Indian/Mauritius', ['Juice', 'my.t money']),
  C('MA', 'Morocco', 'MAD', 2, '+212', 'Africa/Casablanca', ['Orange Money', 'Inwi Money']),
  C('MZ', 'Mozambique', 'MZN', 2, '+258', 'Africa/Maputo', ['M-Pesa', 'e-Mola', 'mKesh']),
  C('NA', 'Namibia', 'NAD', 2, '+264', 'Africa/Windhoek', ['MTC Maris', 'Bank Windhoek EasyWallet']),
  C('NE', 'Niger', 'XOF', 0, '+227', 'Africa/Niamey', ['Airtel Money', 'Moov Money']),
  C('NG', 'Nigeria', 'NGN', 2, '+234', 'Africa/Lagos', ['OPay', 'PalmPay', 'Moniepoint', 'MTN MoMo PSB']),
  C('RW', 'Rwanda', 'RWF', 0, '+250', 'Africa/Kigali', ['MTN MoMo', 'Airtel Money']),
  C('ST', 'São Tomé and Príncipe', 'STN', 2, '+239', 'Africa/Sao_Tome'),
  C('SN', 'Senegal', 'XOF', 0, '+221', 'Africa/Dakar', ['Wave', 'Orange Money', 'Free Money']),
  C('SC', 'Seychelles', 'SCR', 2, '+248', 'Indian/Mahe'),
  C('SL', 'Sierra Leone', 'SLE', 2, '+232', 'Africa/Freetown', ['Orange Money', 'Afrimoney']),
  C('SO', 'Somalia', 'SOS', 2, '+252', 'Africa/Mogadishu', ['EVC Plus', 'Zaad', 'Sahal']),
  C('ZA', 'South Africa', 'ZAR', 2, '+27', 'Africa/Johannesburg', ['SnapScan', 'Zapper', 'MoMo']),
  C('SS', 'South Sudan', 'SSP', 2, '+211', 'Africa/Juba', ['m-Gurush', 'MoMo']),
  C('SD', 'Sudan', 'SDG', 2, '+249', 'Africa/Khartoum', ['Bankak', 'Cashi']),
  C('TZ', 'Tanzania', 'TZS', 2, '+255', 'Africa/Dar_es_Salaam', ['M-Pesa', 'Mixx by Yas', 'Airtel Money', 'HaloPesa']),
  C('TG', 'Togo', 'XOF', 0, '+228', 'Africa/Lome', ['Flooz', 'T-Money']),
  C('TN', 'Tunisia', 'TND', 3, '+216', 'Africa/Tunis', ['D17', 'Flouci']),
  C('UG', 'Uganda', 'UGX', 0, '+256', 'Africa/Kampala', ['MTN MoMo', 'Airtel Money']),
  C('ZM', 'Zambia', 'ZMW', 2, '+260', 'Africa/Lusaka', ['MTN MoMo', 'Airtel Money', 'Zamtel Money']),
  C('ZW', 'Zimbabwe', 'ZWG', 2, '+263', 'Africa/Harare', ['EcoCash', 'OneMoney', 'InnBucks']),
  C('US', 'United States', 'USD', 2, '+1', 'America/New_York', ['Cash App', 'Venmo', 'Zelle']),
];

export const countryByCode = (code: string | undefined | null) => COUNTRIES.find((c) => c.code === code);

/**
 * Turns a locally written number into international form using the country's dialling code,
 * e.g. Ghana "024 123 4567" → "+233241234567". Numbers already starting with + or 00 are kept.
 */
export function normalizePhone(raw: string, dialCode: string | undefined): string {
  let p = raw.replace(/[^0-9+]/g, '');
  if (p.startsWith('00')) p = `+${p.slice(2)}`;
  if (!p.startsWith('+') && dialCode) p = `${dialCode}${p.startsWith('0') ? p.slice(1) : p}`;
  return p;
}
