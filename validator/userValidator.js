// validators/userValidator.js
import * as yup from 'yup';

export const userSchema = yup.object().shape({
    name: yup.string().required(),
    email: yup.string().email().required(),
    password: yup.string().min(6).required(),
    gender: yup.string().oneOf(['male', 'female', 'other']).required(),
    dob: yup.date().required(),
    otp: yup.string().length(6).required()
});

