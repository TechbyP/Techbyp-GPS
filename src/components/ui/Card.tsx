import { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  title?: string;
  onClick?: () => void;
}

const Card = ({ children, className = '', title, onClick }: CardProps) => {
  return (
    <div
      className={`bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 ${
        onClick ? 'cursor-pointer hover:shadow-lg transition-shadow' : ''
      } ${className}`}
      onClick={onClick}
    >
      {title && (
        <h3 className="text-lg font-semibold mb-3 text-gray-900 dark:text-white">
          {title}
        </h3>
      )}
      {children}
    </div>
  );
};

export default Card;
