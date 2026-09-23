import { getCountries } from "@/app/_lib/countries";

// Let's imagine your colleague already built this component 😃

function SelectCountry({ defaultCountry, name, id, className }) {
  const countries = getCountries();
  const selectedCountry = countries.find(
    (country) => country.name === defaultCountry
  );
  const defaultValue = defaultCountry
    ? `${defaultCountry}%${selectedCountry?.flag ?? ""}`
    : "";

  return (
    <select
      name={name}
      id={id}
      // Here we use a trick to encode BOTH the country name and the flag into the value. Then we split them up again later in the server action
      defaultValue={defaultValue}
      className={className}
    >
      <option value="">Select country...</option>
      {defaultCountry && !selectedCountry ? (
        <option value={defaultValue}>{defaultCountry}</option>
      ) : null}
      {countries.map((c) => (
        <option key={c.code} value={`${c.name}%${c.flag}`}>
          {c.name}
        </option>
      ))}
    </select>
  );
}

export default SelectCountry;
