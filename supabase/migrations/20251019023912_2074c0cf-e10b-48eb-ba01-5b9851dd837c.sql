-- Create places table
CREATE TABLE public.places (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id TEXT NOT NULL,
  barrio_principal TEXT,
  direccion_principal TEXT,
  provincia_principal TEXT,
  lat NUMERIC,
  long NUMERIC,
  place_id TEXT,
  comuna TEXT,
  createdAt TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updatedAt TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.places ENABLE ROW LEVEL SECURITY;

-- Create policies for places table
CREATE POLICY "Enable read access for all users" 
ON public.places 
FOR SELECT 
USING (true);

CREATE POLICY "Enable insert for authenticated users only" 
ON public.places 
FOR INSERT 
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Enable update for authenticated users only" 
ON public.places 
FOR UPDATE 
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Enable delete for authenticated users only" 
ON public.places 
FOR DELETE 
USING (auth.uid() IS NOT NULL);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_places_updatedAt
BEFORE UPDATE ON public.places
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add index on client_id for better query performance
CREATE INDEX idx_places_client_id ON public.places(client_id);

-- Add index on place_id for better query performance
CREATE INDEX idx_places_place_id ON public.places(place_id);