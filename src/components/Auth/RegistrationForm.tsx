import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useDarkMode } from '../../hooks/useDarkMode';
import { useLanguage } from '../../hooks/useLanguage';
import { Mail, Lock, User, Building, MapPin, Phone, Globe } from 'lucide-react';
import { userProfileService } from '../../services/userProfileService';
import toast from 'react-hot-toast';

interface RegistrationFormProps {
  onCancel: () => void;
}

export function RegistrationForm({ onCancel }: RegistrationFormProps) {
  const [isDark] = useDarkMode();
  const { t } = useLanguage();
  const { signup } = useAuth();

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  // Step 1: Account
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Step 2: Customer Details
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [company, setCompany] = useState('');
  const [phone, setPhone] = useState('');

  // Step 3: Address
  const [street, setStreet] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('Germany');
  const [federalState, setFederalState] = useState('');

  const federalStates = [
    'Baden-Württemberg',
    'Bayern',
    'Berlin',
    'Brandenburg',
    'Bremen',
    'Hamburg',
    'Hessen',
    'Mecklenburg-Vorpommern',
    'Niedersachsen',
    'Nordrhein-Westfalen',
    'Rheinland-Pfalz',
    'Saarland',
    'Sachsen',
    'Sachsen-Anhalt',
    'Schleswig-Holstein',
    'Thüringen'
  ];

  const handleNext = () => {
    if (step === 1) {
      // Validate account details
      if (!email || !password || !confirmPassword) {
        toast.error(t('auth.fillAllFields') || 'Please fill in all fields');
        return;
      }
      if (password !== confirmPassword) {
        toast.error(t('auth.passwordMismatch') || 'Passwords do not match');
        return;
      }
      if (password.length < 6) {
        toast.error(t('auth.passwordTooShort') || 'Password must be at least 6 characters');
        return;
      }
      setStep(2);
    } else if (step === 2) {
      // Validate customer details
      if (!firstName || !lastName) {
        toast.error(t('auth.fillRequiredFields') || 'Please fill in required fields');
        return;
      }
      setStep(3);
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step < 3) {
      handleNext();
      return;
    }

    // Final validation
    if (!street || !postalCode || !city || !federalState) {
      toast.error(t('auth.fillRequiredFields') || 'Please fill in required fields');
      return;
    }

    setLoading(true);
    try {
      // Create Firebase auth account
      const result = await signup(email, password);
      
      // Create user profile with customer details
      const profileData = {
        uid: result.user.uid,
        email,
        firstName,
        lastName,
        company: company || undefined,
        phone: phone || undefined,
        street,
        postalCode,
        city,
        country,
        federalState,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      console.log('📝 Registration data to save:', profileData);
      await userProfileService.createProfile(profileData);

      toast.success(t('auth.signupSuccess') || 'Account created! Welcome!');
    } catch (error: any) {
      console.error('Registration error:', error);
      toast.error(error.message);
      setLoading(false);
    }
  };

  const inputClass = `w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
    isDark
      ? 'bg-gray-700/50 border-gray-600 text-gray-100 placeholder-gray-500'
      : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
  }`;

  const labelClass = `block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`;

  return (
    <div className="space-y-4">
      {/* Progress Indicator */}
      <div className="flex items-center justify-between mb-6">
        {[1, 2, 3].map((s) => (
          <div key={s} className="flex items-center flex-1">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
                step >= s
                  ? 'bg-blue-600 text-white'
                  : isDark
                  ? 'bg-gray-700 text-gray-400'
                  : 'bg-gray-200 text-gray-500'
              }`}
            >
              {s}
            </div>
            {s < 3 && (
              <div
                className={`flex-1 h-1 mx-2 rounded transition-colors ${
                  step > s
                    ? 'bg-blue-600'
                    : isDark
                    ? 'bg-gray-700'
                    : 'bg-gray-200'
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step Title */}
      <div className="text-center mb-6">
        <h3 className={`text-lg font-semibold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
          {step === 1 && (t('auth.accountDetails') || 'Account Details')}
          {step === 2 && (t('auth.customerDetails') || 'Customer Details')}
          {step === 3 && (t('auth.addressDetails') || 'Address Details')}
        </h3>
        <p className={`text-sm mt-1 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
          {step === 1 && (t('auth.step1Desc') || 'Create your login credentials')}
          {step === 2 && (t('auth.step2Desc') || 'Your contact information')}
          {step === 3 && (t('auth.step3Desc') || 'Your billing address')}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Step 1: Account */}
        {step === 1 && (
          <>
            <div>
              <label className={labelClass}>
                {t('auth.email') || 'Email'} <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Mail className={`absolute left-3 top-2.5 w-4 h-4 ${isDark ? 'text-gray-500' : 'text-gray-400'}`} />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('auth.emailPlaceholder') || 'you@example.com'}
                  required
                  className={`${inputClass} pl-10`}
                />
              </div>
            </div>

            <div>
              <label className={labelClass}>
                {t('auth.password') || 'Password'} <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Lock className={`absolute left-3 top-2.5 w-4 h-4 ${isDark ? 'text-gray-500' : 'text-gray-400'}`} />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('auth.passwordPlaceholder') || '••••••••'}
                  required
                  className={`${inputClass} pl-10`}
                />
              </div>
            </div>

            <div>
              <label className={labelClass}>
                {t('auth.confirmPassword') || 'Confirm Password'} <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Lock className={`absolute left-3 top-2.5 w-4 h-4 ${isDark ? 'text-gray-500' : 'text-gray-400'}`} />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={t('auth.passwordPlaceholder') || '••••••••'}
                  required
                  className={`${inputClass} pl-10`}
                />
              </div>
            </div>
          </>
        )}

        {/* Step 2: Customer Details */}
        {step === 2 && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>
                  {t('profile.firstName') || 'First Name'} <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <User className={`absolute left-3 top-2.5 w-4 h-4 ${isDark ? 'text-gray-500' : 'text-gray-400'}`} />
                  <input
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder={t('auth.firstNamePlaceholder') || 'John'}
                    required
                    className={`${inputClass} pl-10`}
                  />
                </div>
              </div>

              <div>
                <label className={labelClass}>
                  {t('profile.lastName') || 'Last Name'} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder={t('auth.lastNamePlaceholder') || 'Doe'}
                  required
                  className={inputClass}
                />
              </div>
            </div>

            <div>
              <label className={labelClass}>
                {t('profile.company') || 'Company'} ({t('common.optional') || 'optional'})
              </label>
              <div className="relative">
                <Building className={`absolute left-3 top-2.5 w-4 h-4 ${isDark ? 'text-gray-500' : 'text-gray-400'}`} />
                <input
                  type="text"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder={t('auth.companyPlaceholder') || 'Your Company Name'}
                  className={`${inputClass} pl-10`}
                />
              </div>
            </div>

            <div>
              <label className={labelClass}>
                {t('profile.phone') || 'Phone'} ({t('common.optional') || 'optional'})
              </label>
              <div className="relative">
                <Phone className={`absolute left-3 top-2.5 w-4 h-4 ${isDark ? 'text-gray-500' : 'text-gray-400'}`} />
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={t('auth.phonePlaceholder') || '+49 123 456789'}
                  className={`${inputClass} pl-10`}
                />
              </div>
            </div>
          </>
        )}

        {/* Step 3: Address */}
        {step === 3 && (
          <>
            <div>
              <label className={labelClass}>
                {t('profile.street') || 'Street + No.'} <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <MapPin className={`absolute left-3 top-2.5 w-4 h-4 ${isDark ? 'text-gray-500' : 'text-gray-400'}`} />
                <input
                  type="text"
                  value={street}
                  onChange={(e) => setStreet(e.target.value)}
                  placeholder={t('auth.streetPlaceholder') || 'Main Street 123'}
                  required
                  className={`${inputClass} pl-10`}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>
                  {t('profile.postalCode') || 'Postal Code'} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={postalCode}
                  onChange={(e) => setPostalCode(e.target.value)}
                  placeholder={t('auth.postalCodePlaceholder') || '12345'}
                  required
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>
                  {t('profile.city') || 'City'} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder={t('auth.cityPlaceholder') || 'Berlin'}
                  required
                  className={inputClass}
                />
              </div>
            </div>

            <div>
              <label className={labelClass}>
                {t('profile.country') || 'Country'} <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Globe className={`absolute left-3 top-2.5 w-4 h-4 ${isDark ? 'text-gray-500' : 'text-gray-400'}`} />
                <input
                  type="text"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  placeholder={t('auth.countryPlaceholder') || 'Germany'}
                  required
                  className={`${inputClass} pl-10`}
                />
              </div>
            </div>

            <div>
              <label className={labelClass}>
                {t('profile.federalState') || 'Federal State'} <span className="text-red-500">*</span>
              </label>
              <select
                value={federalState}
                onChange={(e) => setFederalState(e.target.value)}
                required
                className={inputClass}
              >
                <option value="">{t('common.select') || 'Select...'}</option>
                {federalStates.map((state) => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        {/* Buttons */}
        <div className="flex gap-3 pt-4">
          {step > 1 && (
            <button
              type="button"
              onClick={handleBack}
              className={`flex-1 py-2 px-4 rounded-lg font-medium text-sm transition-colors ${
                isDark
                  ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              {t('common.back') || 'Back'}
            </button>
          )}

          {step === 1 && (
            <button
              type="button"
              onClick={onCancel}
              className={`flex-1 py-2 px-4 rounded-lg font-medium text-sm transition-colors ${
                isDark
                  ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              {t('common.cancel') || 'Cancel'}
            </button>
          )}

          <button
            type="submit"
            disabled={loading}
            className={`flex-1 py-2 px-4 rounded-lg font-semibold text-sm transition-colors ${
              loading
                ? 'opacity-50 cursor-not-allowed bg-blue-600 text-white'
                : 'bg-blue-600 hover:bg-blue-700 text-white'
            }`}
          >
            {loading
              ? (t('common.processing') || 'Processing...')
              : step === 3
              ? (t('auth.createAccount') || 'Create Account')
              : (t('common.continue') || 'Continue')}
          </button>
        </div>
      </form>
    </div>
  );
}
